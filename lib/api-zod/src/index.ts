export * from "./generated/api";
export * from "./generated/types";
// Orval emits both a path-params zod schema (in api.ts) and a query-params TS
// type with the name `AdminGetMlmReportParams`. The two `export *` lines above
// would collide on that name, so we explicitly re-export the zod schema (the
// dominant consumer of this module) and expose the type under an alias for
// any caller that needs the inferred shape of query params.
export { AdminGetMlmReportParams } from "./generated/api";
export type { AdminGetMlmReportParams as AdminGetMlmReportQueryType } from "./generated/types/adminGetMlmReportParams";
// Same collision: orval emits a zod schema and a TS body type with identical
// names for `/admin/currencies/reorder`. Re-export the zod schema and alias
// the TS body type for callers that need the inferred shape.
export { ReorderAdminCurrenciesBody } from "./generated/api";
export type { ReorderAdminCurrenciesBody as ReorderAdminCurrenciesBodyType } from "./generated/types/reorderAdminCurrenciesBody";
// Same collision: orval emits a zod schema and a TS body type with identical
// names for `/rides/{id}/rate-customer`. Re-export the zod schema and alias
// the TS body type for callers that need the inferred shape.
export { RateCustomerBody } from "./generated/api";
export type { RateCustomerBody as RateCustomerBodyType } from "./generated/types/rateCustomerBody";
// Bidding endpoints — same collision (orval emits both zod schemas and TS
// types under the same names). Re-export zod schemas and alias the TS types.
export {
  CreateBiddingOfferBody,
  AcceptBiddingOfferBody,
  AcceptBiddingOfferResponse,
} from "./generated/api";
export type { CreateBiddingOfferBody as CreateBiddingOfferBodyType } from "./generated/types/createBiddingOfferBody";
export type { AcceptBiddingOfferBody as AcceptBiddingOfferBodyType } from "./generated/types/acceptBiddingOfferBody";
export type { AcceptBiddingOfferResponse as AcceptBiddingOfferResponseType } from "./generated/types/acceptBiddingOfferResponse";
