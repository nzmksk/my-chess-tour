/**
 * Test-side model of the auth-id → users.id bridge.
 *
 * `src/test/setup.ts` stubs `lookupAppUserId` with `appIdFor`, so across the
 * whole suite the two identifier spaces are DELIBERATELY DIFFERENT. That is the
 * point: production writes `users.id = auth_user_id` for self-signup accounts,
 * which means a route leaking a raw auth id into a query behaves identically to
 * a correct one and no test can tell them apart. Making them differ turns that
 * class of bug into a failing assertion instead of a latent one.
 *
 * In a test, `sub` on the mocked JWT is the AUTH id; anything the route then
 * uses to filter or write an application table should be `appIdFor(sub)`:
 *
 *   mockGetClaims.mockResolvedValue({ data: { claims: { sub: USER_ID } } })
 *   expect(builder.eq).toHaveBeenCalledWith("user_id", appIdFor(USER_ID))
 *
 * Use `appIdFor` rather than hardcoding the prefix — the mapping is an
 * implementation detail and assertions should read as "the app id for this
 * auth user".
 */
export function appIdFor(authUserId: string): string {
  return `app-${authUserId}`;
}
