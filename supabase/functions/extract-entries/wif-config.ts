// Anthropic Workload Identity Federation 식별자. 비밀값이 아니다(실제 인증은 로그인 JWT로 한다).
// Claude Console > Workload identity에서 만든 값. Edge Function Secrets에 같은 이름이 있으면 그 값이 우선한다.
export const WIF = {
  organizationId: '8a42cc87-a0e7-48c3-a585-1e5516755503',
  federationRuleId: 'fdrl_015wi1xrSFAdT226ifJwqkeS',
  serviceAccountId: 'svac_01CBKsgqV7oZmzZmwdx8jNQV',
  workspaceId: 'wrkspc_012QhQJ4YRCs77eLHJDVLAG4',
}
