// How the code of this service looks up a balance (gift card orders, the new
// user campaign, SharedBalanceService). It is not an HTTP input any more: up
// to step 6.9 GET /balance took it from the query string as FindByFieldDto,
// so anyone logged in could read the balance of anyone else by changing the
// user slug (QD17). The self view now takes the user id of the token
// (BalanceService.findOneByUserId) and the view on behalf of someone else is
// an internal route that trend calls after checking the role (step 6.10).
export interface BalanceLookup {
  slug?: string | null;
  userSlug?: string | null;
}
