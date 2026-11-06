/** Presentation and eligibility for the existing, manually verified failure repair. */
export function taskRepairGuidance(status: string, billing?: { status?: string; billingPolicy?: string } | null) {
  if (status === 'SUCCESS' || status === 'CANCELLED') {
    return { canReconcileFailure: false, recommendation: '任务已结束，无需按失败修复；如账单有异常，请进入关联账单对账。' };
  }
  if (billing?.status === 'refunded') {
    return { canReconcileFailure: false, recommendation: ['FAILED', 'TIMEOUT'].includes(status)
      ? '任务已结束且已退款，无需重复修复。'
      : '账单已退款，但任务尚未结束。请核对供应商执行结果与任务状态，勿重复退款。' };
  }
  if (billing?.status === 'settled' || billing?.status === 'failed') {
    return { canReconcileFailure: false, recommendation: '请进入关联账单核对结算或扣费异常；不能通过失败修复直接退款。' };
  }
  if (['FAILED', 'TIMEOUT'].includes(status)) {
    const canReconcileFailure = billing?.billingPolicy === 'internal' && billing.status === 'pre_deducted';
    return { canReconcileFailure, recommendation: canReconcileFailure
      ? '任务已结束，账单仍处于预扣状态。请核验供应商失败或取消后，使用受控修复收尾。'
      : '任务已结束，未发现待退的内部预扣款；无需重复修复。如有疑问，请核对关联账单。' };
  }
  return { canReconcileFailure: ['PENDING', 'SUBMITTED', 'PROCESSING'].includes(status),
    recommendation: '先核对供应商实际执行结果。队列缺失不代表供应商失败，不能据此自动退款。' };
}
