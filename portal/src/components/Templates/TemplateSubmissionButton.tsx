import { useState } from 'react';
import { Alert, Button, Form, Input, Modal, message } from 'antd';
import { creationApi } from '../../services/creation-api';
import { getApiErrorMessage } from '../../store/auth-store';

export default function TemplateSubmissionButton({ kind, name, prepare, disabled }: {
  kind: 'workflow' | 'short-drama'; name: string; prepare: () => Promise<string>; disabled?: boolean;
}) {
  const [open, setOpen] = useState(false), [busy, setBusy] = useState(false);
  const [form] = Form.useForm<{ name: string; description: string; instructions: string }>();
  const submit = async () => {
    const values = await form.validateFields(); setBusy(true);
    try {
      const sourceId = await prepare();
      const result = await creationApi.submit({ kind, sourceId, ...values });
      message.success(result.status === 'pending' ? '模板已提交审核，可在「我的作品 → 模板投稿」查看进度' : '此版本已提交过，可在模板投稿中查看状态');
      setOpen(false);
    } catch (error) { message.error(getApiErrorMessage(error, '提交失败，请重试')); }
    finally { setBusy(false); }
  };
  return <><Button disabled={disabled} onClick={() => { form.setFieldsValue({ name, description: '', instructions: '' }); setOpen(true); }}>提交为模板</Button>
    <Modal title="提交模板审核" open={open} confirmLoading={busy} okText="保存快照并提交审核" cancelText="取消" onCancel={busy ? undefined : () => setOpen(false)} onOk={() => void submit()}>
      <Alert type="info" showIcon message="提交故事／流程及提示词的独立快照，供审核后公开复用。" description="不包含私有素材链接、选片、运行记录或密钥。请确认文字内容适合公开；不会自动发布，也不会触发生成。同一保存版本只提交一次。" />
      <Form form={form} layout="vertical" style={{ marginTop: 20 }}>
        <Form.Item name="name" label="模板名称" rules={[{ required: true, whitespace: true }]}><Input maxLength={100} /></Form.Item>
        <Form.Item name="description" label="用途与适合人群" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={3} maxLength={2000} /></Form.Item>
        <Form.Item name="instructions" label="使用步骤、所需素材与限制" rules={[{ required: true, whitespace: true }]}><Input.TextArea rows={4} maxLength={4000} /></Form.Item>
      </Form>
    </Modal></>;
}
