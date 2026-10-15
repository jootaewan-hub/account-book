// Anthropic Workload Identity Federation 식별자. 비밀값이 아니다(실제 인증은 로그인 JWT로 한다).
// Claude Console > Workload identity에서 만든 값. Edge Function Secrets에 같은 이름이 있으면 그 값이 우선한다.
export const WIF = {
  organizationId: '',
  federationRuleId: '',
  serviceAccountId: '',
  workspaceId: '',
}
