import { Alert } from 'antd';
import type { DramaCandidate, DramaPlan } from '../../services/drama-api';
import { exportVersionState, renderDifferences } from '../../../../src/short-drama/drama-version';

export default function DramaVersionStatus({plan,candidates,candidate}:{plan:DramaPlan;candidates:DramaCandidate[];candidate?:DramaCandidate}) {
  const state=exportVersionState(plan,candidates), reference=candidate || state.matched || state.latest;
  if(!reference) return <Alert type="info" message="当前草稿尚无成片" description="确认选片与设置后可导出第一个版本。"/>;
  const differences=renderDifferences(plan,reference.renderSource);
  return <Alert type={differences===undefined?'info':differences.length?'warning':'success'} message={differences===undefined?'旧成片无法自动核对':differences.length?(candidate?'当前草稿与此成片不同':'当前草稿修改尚未导出'):(candidate?'此成片与当前草稿一致':'当前草稿已导出')}
    description={differences===undefined?'此文件没有输出版本记录，不能据此判断当前草稿是否已导出。新导出的版本将自动记录。':<>{`来自保存版本 ${reference.renderSource!.revision}。`}{differences.length?` 不同项：${differences.join('；')}。历史文件保留，需重新导出才包含修改。`:'当前画面、剪辑、字幕和声音设置一致。改名、浏览步骤或调整生成配置不会误判为未导出。'}</>}/>;
}
