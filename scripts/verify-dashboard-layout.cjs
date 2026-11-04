/** Layout checks against a local build and isolated API fixtures. No live writes. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const root = path.resolve(__dirname, '../dashboard/dist');
const out = path.resolve(__dirname, '../output/dashboard-layout');
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.css': 'text/css', '.svg': 'image/svg+xml' };
const server = http.createServer((req, res) => {
  const requested = path.resolve(root, '.' + new URL(req.url, 'http://localhost').pathname);
  if (!requested.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  const file = fs.existsSync(requested) && fs.statSync(requested).isFile() ? requested : path.join(root, 'index.html');
  res.setHeader('Content-Type', mime[path.extname(file)] || 'application/octet-stream');
  fs.createReadStream(file).pipe(res);
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const errors = [], reports = [];
  fs.mkdirSync(out, { recursive: true });
  try {
    for (const [width, height] of [[1440, 900], [1024, 768], [390, 844]]) {
      const context = await browser.newContext({ viewport: { width, height } });
      await context.addInitScript(() => {
        if (!localStorage.getItem('token')) {
          localStorage.setItem('token', 'layout-fixture');
          localStorage.setItem('roles', '["super_admin"]');
        }
      });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      page.on('pageerror', error => errors.push(error.message));
      const model = {
        _id: 'layout-model', model_id: 'layout-tts', model_type: 'tts', provider: 'akool-openapi',
        provider_model_name: 'layout-tts', model_name: '布局验证配音模型', disabled: true, revision: 0,
        params: { text: { type: 'string', required: true, label: '配音文本', ui_type: 'textarea' } },
        unit_price_map: {}, docs: { limitations: ['本地布局验证数据'] },
      };
      let modelRows = Array.from({ length: 40 }, (_, i) => ({ ...model, _id: `row-${i}`, model_id: `model-${i}`, update_time: Date.UTC(2026, 10, 3) - i * 60000 }));
      const deletionRequests = [];
      await page.route('**/api/v1/admin/**', route => {
        const endpoint = new URL(route.request().url()).pathname.replace('/api/v1/admin', '');
        let data = [];
        if (route.request().method() === 'DELETE') {
          deletionRequests.push({ endpoint, body: route.request().postDataJSON() });
          const body = route.request().postDataJSON();
          if (endpoint === '/models/bulk') {
            const results = body.items.map((item, i) => i === 1 && deletionRequests.length === 1
              ? { id: item.id, status: 'failed', error: '仍关联路由，请先处理关联数据' }
              : { id: item.id, status: 'success' });
            modelRows = modelRows.filter(row => !results.some(result => result.id === row._id && result.status === 'success'));
            data = { results };
          } else {
            const id = endpoint.split('/').pop();
            modelRows = modelRows.filter(row => row._id !== id);
            data = { id, deleted: true };
          }
          return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
        }
        if (endpoint === '/menu') data = [{ key: 'models', label: '模型管理', children: [{ key: 'models', path: '/models', label: '模型配置' }] }];
        if (endpoint === '/models/detail') data = model;
        if (endpoint === '/models') {
          const params = new URL(route.request().url()).searchParams;
          const currentPage = Number(params.get('page')) || 1, size = Number(params.get('pageSize')) || 20;
          const direction = params.get('sort_order') === 'asc' ? 1 : -1;
          const orderedRows = [...modelRows].sort((a, b) => direction * (a.update_time - b.update_time));
          data = { items: orderedRows.slice((currentPage - 1) * size, currentPage * size), total: modelRows.length };
        }
        if (endpoint === '/notifications/unread-count') data = { count: 0 };
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ code: 0, data }) });
      });
      const content = page.locator('.admin-page-content');
      const header = page.locator('.admin-page-header');
      const footer = page.locator('.admin-page-footer');
      for (const pathname of ['/models/edit/layout-model', '/models/create']) {
        await page.goto(origin + pathname);
        try {
          await footer.getByRole('button', { name: pathname.includes('/edit/') ? /保存并立即生效/ : /创建配置/ }).waitFor();
        } catch (error) {
          await page.screenshot({ path: path.join(out, 'failure.png') });
          console.error({ errors, body: (await page.locator('body').innerText()).slice(0, 1600) });
          throw error;
        }
        await page.evaluate(() => document.fonts.ready);
        // Ant Design animates the responsive sidebar and wrapped toolbars on mount.
        await page.waitForTimeout(400);
        const beforeHeader = await header.boundingBox(), beforeFooter = await footer.boundingBox();
        await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
        assert(await content.evaluate(el => el.scrollTop > 0), 'The form must scroll');
        const afterHeader = await header.boundingBox(), afterFooter = await footer.boundingBox();
        assert(Math.abs(beforeHeader.y - afterHeader.y) < 1, 'Header moved on scroll');
        assert(Math.abs(beforeFooter.y - afterFooter.y) < 1, `Footer moved on scroll ${width} ${pathname}: ${JSON.stringify({beforeFooter, afterFooter})}`);
        assert(afterHeader.y >= 0 && afterFooter.y + afterFooter.height <= height, 'Actions outside viewport');
        const bodyBox = await content.boundingBox();
        assert(bodyBox.height > 100, 'Toolbar leaves too little form space');
        assert(afterHeader.y + afterHeader.height <= bodyBox.y + 1 && bodyBox.y + bodyBox.height <= afterFooter.y + 1, `Actions overlap content ${width} ${pathname}: ${JSON.stringify({afterHeader, bodyBox, afterFooter})}`);
        if (pathname.includes('/edit/')) {
          await header.getByRole('button', { name: '保存草稿', exact: true }).waitFor();
          await page.screenshot({ path: path.join(out, `edit-${width}.png`) });
          await page.getByLabel('model_name（展示名称）', { exact: true }).fill('布局验证已修改');
          await footer.getByRole('button', { name: /取\s*消/ }).click();
          const confirm = page.locator('.ant-modal-confirm');
          await confirm.waitFor();
          await page.waitForFunction(() => !document.querySelector('.ant-zoom-enter, .ant-zoom-appear'));
          const confirmContent = confirm.locator('.ant-modal-confirm-content');
          await confirmContent.evaluate(el => { const block = document.createElement('div'); block.style.height = '2000px'; el.append(block); });
          const confirmTitle = await confirm.locator('.ant-modal-confirm-title').boundingBox();
          const confirmButtons = await confirm.locator('.ant-modal-confirm-btns').boundingBox();
          await confirmContent.evaluate(el => { el.scrollTop = el.scrollHeight; });
          assert.equal((await confirm.locator('.ant-modal-confirm-title').boundingBox()).y, confirmTitle.y);
          assert.equal((await confirm.locator('.ant-modal-confirm-btns').boundingBox()).y, confirmButtons.y);
          assert(confirmButtons.y + confirmButtons.height <= height, 'Confirmation buttons outside viewport');
          await confirm.getByRole('button', { name: /取\s*消/ }).click();
        }
        reports.push({ width, pathname, contentHeight: bodyBox.height, fixedActions: true });
      }
      await page.goto(origin + '/models');
      await header.getByText('模型配置', { exact: true }).waitFor();
      await page.getByText('model-19', { exact: true }).waitFor();
      await footer.getByRole('button', { name: '批量删除', exact: true }).waitFor();
      assert(await footer.locator('.ant-pagination').isVisible(), 'Pagination must share the footer with batch actions');
      await page.goto(origin + '/models?page=2&provider=akool-openapi&status=enabled');
      await page.getByText('model-20', { exact: true }).waitFor();
      const tableScroller = page.locator('.ant-table-content');
      await tableScroller.evaluate(el => { el.scrollLeft = el.scrollWidth; });
      const timeHeader = page.getByRole('columnheader', { name: /更新时间/ });
      await timeHeader.click();
      await page.waitForURL(url => url.searchParams.get('sort_order') === 'asc' && url.searchParams.get('page') === '1');
      assert.equal(new URL(page.url()).searchParams.get('provider'), 'akool-openapi');
      assert.equal(new URL(page.url()).searchParams.get('status'), 'enabled');
      await page.getByText('model-39', { exact: true }).waitFor();
      assert.equal(await timeHeader.getAttribute('aria-sort'), 'ascending');
      await timeHeader.click();
      await page.waitForURL(url => url.searchParams.get('sort_order') === 'desc');
      await page.getByText('model-0', { exact: true }).waitFor();
      assert.equal(await timeHeader.getAttribute('aria-sort'), 'descending');
      await tableScroller.evaluate(el => { el.scrollLeft = 0; });
      const listHeader = await header.boundingBox();
      await content.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.equal((await header.boundingBox()).y, listHeader.y, 'List filters moved on scroll');
      const rows = page.locator('.ant-table-tbody tr.ant-table-row');
      await rows.nth(0).getByRole('checkbox').check();
      await rows.nth(1).getByRole('checkbox').check();
      await footer.getByText('已选 2 条', { exact: true }).waitFor();
      if (width === 1440) {
        const batchBox = await footer.getByRole('button', { name: '批量删除', exact: true }).boundingBox();
        const pageBox = await footer.locator('.ant-pagination').boundingBox();
        assert(Math.abs(batchBox.y - pageBox.y) < 10, 'Batch controls and pagination must share one row on desktop');
      }
      await page.screenshot({ path: path.join(out, `list-${width}.png`) });
      await footer.getByRole('button', { name: '批量删除', exact: true }).click();
      const confirmation = page.locator('.ant-modal-confirm');
      await confirmation.getByRole('button', { name: /删\s*除/ }).click();
      const failureReport = page.locator('.ant-modal-confirm').filter({ hasText: '删除成功 1 条，失败 1 条' });
      await failureReport.getByText('仍关联路由，请先处理关联数据', { exact: true }).waitFor();
      await failureReport.getByRole('button', { name: /确\s*定|知\s*道/ }).click();
      await footer.getByText('已选 1 条', { exact: true }).waitFor();
      const remaining = rows.filter({ hasText: 'model-1' }).filter({ has: page.getByText('model-1', { exact: true }) });
      await remaining.getByRole('button', { name: /删\s*除/ }).click();
      await page.locator('.ant-modal-confirm').getByRole('button', { name: /删\s*除/ }).click();
      await footer.getByText('已选 0 条', { exact: true }).waitFor();
      assert(deletionRequests[0].body.items.every(item => item.expected_revision === 0), 'Bulk delete omitted revisions');
      assert.equal(deletionRequests[1].body.expected_revision, 0, 'Single delete omitted revision');
      await page.goto(origin + '/models?page=2');
      await rows.first().waitFor();
      await page.locator('.ant-table-thead').getByRole('checkbox').check();
      await footer.getByRole('button', { name: '批量删除', exact: true }).click();
      await page.locator('.ant-modal-confirm').getByRole('button', { name: /删\s*除/ }).click();
      await page.waitForURL(url => url.searchParams.get('page') === '1');
      await page.getByText('model-2', { exact: true }).waitFor();
      await page.evaluate(() => { localStorage.setItem('roles', '[]'); localStorage.setItem('permissions', '["model:read"]'); });
      await page.reload();
      await page.getByText('model-2', { exact: true }).waitFor();
      assert.equal(await footer.getByRole('button', { name: '批量删除', exact: true }).count(), 0, 'Viewer has batch delete');
      assert.equal(await rows.getByRole('button', { name: /删\s*除/ }).count(), 0, 'Viewer has single delete');
      await page.evaluate(() => localStorage.setItem('roles', '["super_admin"]'));
      await page.reload();
      await page.goto(origin + '/provider-configs');
      await header.getByRole('button', { name: /添加厂商/ }).click();
      const modal = page.locator('.ant-modal-content:visible');
      await modal.waitFor();
      await page.waitForFunction(() => !document.querySelector('.ant-zoom-enter, .ant-zoom-appear'));
      const modalBody = modal.locator('.ant-modal-body');
      // Force a long body to exercise the shared dialog layout at every viewport.
      await modalBody.evaluate(el => { const block = document.createElement('div'); block.style.height = '2000px'; el.append(block); });
      const modalHeader = modal.locator('.ant-modal-header'), modalFooter = modal.locator('.ant-modal-footer');
      const top = await modalHeader.boundingBox(), bottom = await modalFooter.boundingBox();
      await modalBody.evaluate(el => { el.scrollTop = el.scrollHeight; });
      assert.equal((await modalHeader.boundingBox()).y, top.y, 'Dialog header moved');
      assert.equal((await modalFooter.boundingBox()).y, bottom.y, 'Dialog footer moved');
      assert(bottom.y + bottom.height <= height, 'Dialog buttons outside viewport');
      await page.screenshot({ path: path.join(out, `dialog-${width}.png`) });
      reports.push({ width, listAndDialogFixed: true });
      await context.close();
    }
    assert.deepEqual(errors, [], 'Browser errors');
    console.log(JSON.stringify(reports, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
