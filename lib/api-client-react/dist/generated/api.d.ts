import type { QueryKey, UseMutationOptions, UseMutationResult, UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import type { AcceptBiddingOfferBody, AcceptBiddingOfferResponse, ActivateDestinationModeRequest, ActivateNextQueuedRideRequest, ActivateNextQueuedRideResult, ActiveNotificationSoundsResponse, AdminContactSubmissionUpdate, AdminCreateSitePage201, AdminCurrencyListResponse, AdminCurrencyRefreshResponse, AdminCurrencySetDefaultResponse, AdminCurrencySingleResponse, AdminDeleteContactSubmission200, AdminDeleteSitePage200, AdminFinalizeNotificationSound200, AdminGetMlmReportParams, AdminGetSitePage200, AdminGetSiteSettings200, AdminListContactSubmissions200, AdminListContactSubmissionsParams, AdminListReferralEarningsParams, AdminListReferralLevels200, AdminListSitePages200, AdminNotificationSoundsListResponse, AdminReferralEarningsSummaryParams, AdminSearchMlmReportUsersParams, AdminSitePageUpsert, AdminUpdateContactSubmission200, AdminUpdateSitePage200, AdminUpdateSiteSettings200, AdminUpsertReferralLevel200, AirportSurchargeInput, AuthMe, AuthSession, BiddingNearbyResponse, BiddingOfferResponse, ChatFinalizeRequest, ChatUploadRequest, ChatUploadResponse, CheckEmailRequest, CompleteProfileRequest, CreateAdminCurrencyRequest, CreateAirportLocation201, CreateAirportLocationRequest, CreateAirportSurcharge201, CreateBiddingOfferBody, CreateTripMessage200, CreateTripMessage201, CreateTripMessage429, CreateTripMessageRequest, DeleteAirportSurcharge200, DemandZoneSnapshot, DestinationModeState, DriverSavedPlace, DriverSavedPlacesResponse, EmailExistsResult, ErrorEnvelope, FinalizeChatUpload200, FinalizeNotificationSoundRequest, GetAirportSurcharge200, GetBiddingNearbyParams, GetDriverQueuedRequests200, GetDriverRatingSummary200, GetGlobalUnreadCount200, GetReferralTreeParams, GetSitePageBySlug200, GetSiteSettings200, GetTripUnreadCount200, GetUserRatingSummary200, HealthStatus, ListAirportLocations200, ListAirportSurcharges200, ListSitePages200, ListSitePagesParams, ListTripMessages200, MarkTripMessagesRead200, MarkTripMessagesReadRequest, MlmReportResponse, MlmReportSearchResponse, MlmReportUserEarningsResponse, NotificationSoundUploadUrlRequest, NotificationSoundsManifestResponse, OkResponse, PasswordLoginRequest, PostDriverQueuedRequestsRideIdAccept200, PostDriverQueuedRequestsRideIdDecline200, QuickRepliesResponse, RateCustomer200, RateCustomerBody, ReferralEarningsListResponse, ReferralEarningsSummaryResponse, ReferralTreeResponse, ReferralsMeResponse, RenameNotificationSoundRequest, ReorderAdminCurrenciesBody, ReplaceAirportSurcharge200, ResetPassword200, ResetPasswordRequest, SetAirportSurchargeStatus200, SetAirportSurchargeStatusRequest, SiteContactRequest, SiteContactResponse, SiteSettings, SoundInUseError, UpdateAdminCurrency200, UpdateAdminCurrencyRequest, UpdateAirportSurcharge200, UpdateBuildHashRequest, UpdateQuickRepliesRequest, UpdateReferralLevelRequest, UploadUrlRequest, UploadUrlResponse, UpsertDriverSavedPlaceRequest } from "./api.schemas";
import { customFetch } from "../custom-fetch";
import type { ErrorType, BodyType } from "../custom-fetch";
type AwaitedInput<T> = PromiseLike<T> | T;
type Awaited<O> = O extends AwaitedInput<infer T> ? T : never;
type SecondParameter<T extends (...args: never) => unknown> = Parameters<T>[1];
/**
 * @summary Driver rates a rider after a completed trip.
 */
export declare const getRateCustomerUrl: (id: string) => string;
export declare const rateCustomer: (id: string, rateCustomerBody: RateCustomerBody, options?: RequestInit) => Promise<RateCustomer200>;
export declare const getRateCustomerMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof rateCustomer>>, TError, {
        id: string;
        data: BodyType<RateCustomerBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof rateCustomer>>, TError, {
    id: string;
    data: BodyType<RateCustomerBody>;
}, TContext>;
export type RateCustomerMutationResult = NonNullable<Awaited<ReturnType<typeof rateCustomer>>>;
export type RateCustomerMutationBody = BodyType<RateCustomerBody>;
export type RateCustomerMutationError = ErrorType<void>;
/**
 * @summary Driver rates a rider after a completed trip.
 */
export declare const useRateCustomer: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof rateCustomer>>, TError, {
        id: string;
        data: BodyType<RateCustomerBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof rateCustomer>>, TError, {
    id: string;
    data: BodyType<RateCustomerBody>;
}, TContext>;
/**
 * @summary Get a driver's aggregate rating summary.
 */
export declare const getGetDriverRatingSummaryUrl: (driverId: string) => string;
export declare const getDriverRatingSummary: (driverId: string, options?: RequestInit) => Promise<GetDriverRatingSummary200>;
export declare const getGetDriverRatingSummaryQueryKey: (driverId: string) => readonly [`/api/drivers/${string}/rating-summary`];
export declare const getGetDriverRatingSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getDriverRatingSummary>>, TError = ErrorType<void>>(driverId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDriverRatingSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDriverRatingSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDriverRatingSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getDriverRatingSummary>>>;
export type GetDriverRatingSummaryQueryError = ErrorType<void>;
/**
 * @summary Get a driver's aggregate rating summary.
 */
export declare function useGetDriverRatingSummary<TData = Awaited<ReturnType<typeof getDriverRatingSummary>>, TError = ErrorType<void>>(driverId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDriverRatingSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get a user's aggregate customer (rider) rating summary.
 */
export declare const getGetUserRatingSummaryUrl: (userId: string) => string;
export declare const getUserRatingSummary: (userId: string, options?: RequestInit) => Promise<GetUserRatingSummary200>;
export declare const getGetUserRatingSummaryQueryKey: (userId: string) => readonly [`/api/users/${string}/rating-summary`];
export declare const getGetUserRatingSummaryQueryOptions: <TData = Awaited<ReturnType<typeof getUserRatingSummary>>, TError = ErrorType<void>>(userId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserRatingSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getUserRatingSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetUserRatingSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof getUserRatingSummary>>>;
export type GetUserRatingSummaryQueryError = ErrorType<void>;
/**
 * @summary Get a user's aggregate customer (rider) rating summary.
 */
export declare function useGetUserRatingSummary<TData = Awaited<ReturnType<typeof getUserRatingSummary>>, TError = ErrorType<void>>(userId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getUserRatingSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List configured airport zones (service areas of type airport_surcharge).
 */
export declare const getListAirportLocationsUrl: () => string;
export declare const listAirportLocations: (options?: RequestInit) => Promise<ListAirportLocations200>;
export declare const getListAirportLocationsQueryKey: () => readonly ["/api/admin/airport-locations"];
export declare const getListAirportLocationsQueryOptions: <TData = Awaited<ReturnType<typeof listAirportLocations>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAirportLocations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAirportLocations>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAirportLocationsQueryResult = NonNullable<Awaited<ReturnType<typeof listAirportLocations>>>;
export type ListAirportLocationsQueryError = ErrorType<unknown>;
/**
 * @summary List configured airport zones (service areas of type airport_surcharge).
 */
export declare function useListAirportLocations<TData = Awaited<ReturnType<typeof listAirportLocations>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAirportLocations>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a new airport zone.
 */
export declare const getCreateAirportLocationUrl: () => string;
export declare const createAirportLocation: (createAirportLocationRequest: CreateAirportLocationRequest, options?: RequestInit) => Promise<CreateAirportLocation201>;
export declare const getCreateAirportLocationMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAirportLocation>>, TError, {
        data: BodyType<CreateAirportLocationRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAirportLocation>>, TError, {
    data: BodyType<CreateAirportLocationRequest>;
}, TContext>;
export type CreateAirportLocationMutationResult = NonNullable<Awaited<ReturnType<typeof createAirportLocation>>>;
export type CreateAirportLocationMutationBody = BodyType<CreateAirportLocationRequest>;
export type CreateAirportLocationMutationError = ErrorType<unknown>;
/**
 * @summary Create a new airport zone.
 */
export declare const useCreateAirportLocation: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAirportLocation>>, TError, {
        data: BodyType<CreateAirportLocationRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAirportLocation>>, TError, {
    data: BodyType<CreateAirportLocationRequest>;
}, TContext>;
/**
 * @summary List all airport surcharge rules.
 */
export declare const getListAirportSurchargesUrl: () => string;
export declare const listAirportSurcharges: (options?: RequestInit) => Promise<ListAirportSurcharges200>;
export declare const getListAirportSurchargesQueryKey: () => readonly ["/api/admin/airport-surcharges"];
export declare const getListAirportSurchargesQueryOptions: <TData = Awaited<ReturnType<typeof listAirportSurcharges>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAirportSurcharges>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAirportSurcharges>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAirportSurchargesQueryResult = NonNullable<Awaited<ReturnType<typeof listAirportSurcharges>>>;
export type ListAirportSurchargesQueryError = ErrorType<unknown>;
/**
 * @summary List all airport surcharge rules.
 */
export declare function useListAirportSurcharges<TData = Awaited<ReturnType<typeof listAirportSurcharges>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAirportSurcharges>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a new airport surcharge for an (airport, vehicle type) pair.
 */
export declare const getCreateAirportSurchargeUrl: () => string;
export declare const createAirportSurcharge: (airportSurchargeInput: AirportSurchargeInput, options?: RequestInit) => Promise<CreateAirportSurcharge201>;
export declare const getCreateAirportSurchargeMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAirportSurcharge>>, TError, {
        data: BodyType<AirportSurchargeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAirportSurcharge>>, TError, {
    data: BodyType<AirportSurchargeInput>;
}, TContext>;
export type CreateAirportSurchargeMutationResult = NonNullable<Awaited<ReturnType<typeof createAirportSurcharge>>>;
export type CreateAirportSurchargeMutationBody = BodyType<AirportSurchargeInput>;
export type CreateAirportSurchargeMutationError = ErrorType<void>;
/**
 * @summary Create a new airport surcharge for an (airport, vehicle type) pair.
 */
export declare const useCreateAirportSurcharge: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAirportSurcharge>>, TError, {
        data: BodyType<AirportSurchargeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAirportSurcharge>>, TError, {
    data: BodyType<AirportSurchargeInput>;
}, TContext>;
/**
 * @summary Fetch a single airport surcharge by id.
 */
export declare const getGetAirportSurchargeUrl: (id: string) => string;
export declare const getAirportSurcharge: (id: string, options?: RequestInit) => Promise<GetAirportSurcharge200>;
export declare const getGetAirportSurchargeQueryKey: (id: string) => readonly [`/api/admin/airport-surcharges/${string}`];
export declare const getGetAirportSurchargeQueryOptions: <TData = Awaited<ReturnType<typeof getAirportSurcharge>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAirportSurcharge>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAirportSurcharge>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAirportSurchargeQueryResult = NonNullable<Awaited<ReturnType<typeof getAirportSurcharge>>>;
export type GetAirportSurchargeQueryError = ErrorType<void>;
/**
 * @summary Fetch a single airport surcharge by id.
 */
export declare function useGetAirportSurcharge<TData = Awaited<ReturnType<typeof getAirportSurcharge>>, TError = ErrorType<void>>(id: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAirportSurcharge>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Full replace of an airport surcharge.
 */
export declare const getReplaceAirportSurchargeUrl: (id: string) => string;
export declare const replaceAirportSurcharge: (id: string, airportSurchargeInput: AirportSurchargeInput, options?: RequestInit) => Promise<ReplaceAirportSurcharge200>;
export declare const getReplaceAirportSurchargeMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof replaceAirportSurcharge>>, TError, {
        id: string;
        data: BodyType<AirportSurchargeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof replaceAirportSurcharge>>, TError, {
    id: string;
    data: BodyType<AirportSurchargeInput>;
}, TContext>;
export type ReplaceAirportSurchargeMutationResult = NonNullable<Awaited<ReturnType<typeof replaceAirportSurcharge>>>;
export type ReplaceAirportSurchargeMutationBody = BodyType<AirportSurchargeInput>;
export type ReplaceAirportSurchargeMutationError = ErrorType<void>;
/**
 * @summary Full replace of an airport surcharge.
 */
export declare const useReplaceAirportSurcharge: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof replaceAirportSurcharge>>, TError, {
        id: string;
        data: BodyType<AirportSurchargeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof replaceAirportSurcharge>>, TError, {
    id: string;
    data: BodyType<AirportSurchargeInput>;
}, TContext>;
/**
 * @summary Partial update of an airport surcharge.
 */
export declare const getUpdateAirportSurchargeUrl: (id: string) => string;
export declare const updateAirportSurcharge: (id: string, airportSurchargeInput: AirportSurchargeInput, options?: RequestInit) => Promise<UpdateAirportSurcharge200>;
export declare const getUpdateAirportSurchargeMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAirportSurcharge>>, TError, {
        id: string;
        data: BodyType<AirportSurchargeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAirportSurcharge>>, TError, {
    id: string;
    data: BodyType<AirportSurchargeInput>;
}, TContext>;
export type UpdateAirportSurchargeMutationResult = NonNullable<Awaited<ReturnType<typeof updateAirportSurcharge>>>;
export type UpdateAirportSurchargeMutationBody = BodyType<AirportSurchargeInput>;
export type UpdateAirportSurchargeMutationError = ErrorType<void>;
/**
 * @summary Partial update of an airport surcharge.
 */
export declare const useUpdateAirportSurcharge: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAirportSurcharge>>, TError, {
        id: string;
        data: BodyType<AirportSurchargeInput>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAirportSurcharge>>, TError, {
    id: string;
    data: BodyType<AirportSurchargeInput>;
}, TContext>;
/**
 * @summary Delete an airport surcharge.
 */
export declare const getDeleteAirportSurchargeUrl: (id: string) => string;
export declare const deleteAirportSurcharge: (id: string, options?: RequestInit) => Promise<DeleteAirportSurcharge200>;
export declare const getDeleteAirportSurchargeMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAirportSurcharge>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteAirportSurcharge>>, TError, {
    id: string;
}, TContext>;
export type DeleteAirportSurchargeMutationResult = NonNullable<Awaited<ReturnType<typeof deleteAirportSurcharge>>>;
export type DeleteAirportSurchargeMutationError = ErrorType<unknown>;
/**
 * @summary Delete an airport surcharge.
 */
export declare const useDeleteAirportSurcharge: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAirportSurcharge>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteAirportSurcharge>>, TError, {
    id: string;
}, TContext>;
/**
 * @summary Toggle the active flag of an airport surcharge.
 */
export declare const getSetAirportSurchargeStatusUrl: (id: string) => string;
export declare const setAirportSurchargeStatus: (id: string, setAirportSurchargeStatusRequest: SetAirportSurchargeStatusRequest, options?: RequestInit) => Promise<SetAirportSurchargeStatus200>;
export declare const getSetAirportSurchargeStatusMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setAirportSurchargeStatus>>, TError, {
        id: string;
        data: BodyType<SetAirportSurchargeStatusRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof setAirportSurchargeStatus>>, TError, {
    id: string;
    data: BodyType<SetAirportSurchargeStatusRequest>;
}, TContext>;
export type SetAirportSurchargeStatusMutationResult = NonNullable<Awaited<ReturnType<typeof setAirportSurchargeStatus>>>;
export type SetAirportSurchargeStatusMutationBody = BodyType<SetAirportSurchargeStatusRequest>;
export type SetAirportSurchargeStatusMutationError = ErrorType<unknown>;
/**
 * @summary Toggle the active flag of an airport surcharge.
 */
export declare const useSetAirportSurchargeStatus: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setAirportSurchargeStatus>>, TError, {
        id: string;
        data: BodyType<SetAirportSurchargeStatusRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof setAirportSurchargeStatus>>, TError, {
    id: string;
    data: BodyType<SetAirportSurchargeStatusRequest>;
}, TContext>;
/**
 * Snapshot of the latest aggregated demand-vs-supply zones. Updated by a
server-side aggregator on a fixed interval (see admin Heatmap settings).
The same data is broadcast as diffs over Socket.IO room
`drivers:heatmap`. Capped to ~200 zones, ordered by surgeMultiplier
descending.

 * @summary Real-time surge demand zones for the driver home heatmap.
 */
export declare const getGetDemandZonesUrl: () => string;
export declare const getDemandZones: (options?: RequestInit) => Promise<DemandZoneSnapshot>;
export declare const getGetDemandZonesQueryKey: () => readonly ["/api/demand-zones"];
export declare const getGetDemandZonesQueryOptions: <TData = Awaited<ReturnType<typeof getDemandZones>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDemandZones>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDemandZones>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDemandZonesQueryResult = NonNullable<Awaited<ReturnType<typeof getDemandZones>>>;
export type GetDemandZonesQueryError = ErrorType<unknown>;
/**
 * @summary Real-time surge demand zones for the driver home heatmap.
 */
export declare function useGetDemandZones<TData = Awaited<ReturnType<typeof getDemandZones>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDemandZones>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Get the signed-in user's referral code, totals, and recent earnings.
 */
export declare const getGetMyReferralsUrl: () => string;
export declare const getMyReferrals: (options?: RequestInit) => Promise<ReferralsMeResponse>;
export declare const getGetMyReferralsQueryKey: () => readonly ["/api/referrals/me"];
export declare const getGetMyReferralsQueryOptions: <TData = Awaited<ReturnType<typeof getMyReferrals>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyReferrals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyReferrals>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyReferralsQueryResult = NonNullable<Awaited<ReturnType<typeof getMyReferrals>>>;
export type GetMyReferralsQueryError = ErrorType<unknown>;
/**
 * @summary Get the signed-in user's referral code, totals, and recent earnings.
 */
export declare function useGetMyReferrals<TData = Awaited<ReturnType<typeof getMyReferrals>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyReferrals>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Alias of GET /referrals/me matching the task contract.
 */
export declare const getGetMyReferralsAliasUrl: () => string;
export declare const getMyReferralsAlias: (options?: RequestInit) => Promise<ReferralsMeResponse>;
export declare const getGetMyReferralsAliasQueryKey: () => readonly ["/api/me/referrals"];
export declare const getGetMyReferralsAliasQueryOptions: <TData = Awaited<ReturnType<typeof getMyReferralsAlias>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyReferralsAlias>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyReferralsAlias>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyReferralsAliasQueryResult = NonNullable<Awaited<ReturnType<typeof getMyReferralsAlias>>>;
export type GetMyReferralsAliasQueryError = ErrorType<unknown>;
/**
 * @summary Alias of GET /referrals/me matching the task contract.
 */
export declare function useGetMyReferralsAlias<TData = Awaited<ReturnType<typeof getMyReferralsAlias>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyReferralsAlias>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Returns the referral tree rooted at the signed-in user (members),
or at the user identified by `userId` (admins only). Tree depth is
capped at 3 levels.

 * @summary Get the 3-level referral tree for a user.
 */
export declare const getGetReferralTreeUrl: (params?: GetReferralTreeParams) => string;
export declare const getReferralTree: (params?: GetReferralTreeParams, options?: RequestInit) => Promise<ReferralTreeResponse>;
export declare const getGetReferralTreeQueryKey: (params?: GetReferralTreeParams) => readonly ["/api/referrals/tree", ...GetReferralTreeParams[]];
export declare const getGetReferralTreeQueryOptions: <TData = Awaited<ReturnType<typeof getReferralTree>>, TError = ErrorType<ErrorEnvelope>>(params?: GetReferralTreeParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReferralTree>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getReferralTree>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetReferralTreeQueryResult = NonNullable<Awaited<ReturnType<typeof getReferralTree>>>;
export type GetReferralTreeQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Get the 3-level referral tree for a user.
 */
export declare function useGetReferralTree<TData = Awaited<ReturnType<typeof getReferralTree>>, TError = ErrorType<ErrorEnvelope>>(params?: GetReferralTreeParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getReferralTree>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Lightweight search by name, phone, email, or referral code, scoped to
the admin MLM report page. Returns up to 20 matches.

 * @summary Search users / drivers as candidates for the root of an MLM report.
 */
export declare const getAdminSearchMlmReportUsersUrl: (params: AdminSearchMlmReportUsersParams) => string;
export declare const adminSearchMlmReportUsers: (params: AdminSearchMlmReportUsersParams, options?: RequestInit) => Promise<MlmReportSearchResponse>;
export declare const getAdminSearchMlmReportUsersQueryKey: (params?: AdminSearchMlmReportUsersParams) => readonly ["/api/admin/mlm-report/search", ...AdminSearchMlmReportUsersParams[]];
export declare const getAdminSearchMlmReportUsersQueryOptions: <TData = Awaited<ReturnType<typeof adminSearchMlmReportUsers>>, TError = ErrorType<unknown>>(params: AdminSearchMlmReportUsersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminSearchMlmReportUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminSearchMlmReportUsers>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminSearchMlmReportUsersQueryResult = NonNullable<Awaited<ReturnType<typeof adminSearchMlmReportUsers>>>;
export type AdminSearchMlmReportUsersQueryError = ErrorType<unknown>;
/**
 * @summary Search users / drivers as candidates for the root of an MLM report.
 */
export declare function useAdminSearchMlmReportUsers<TData = Awaited<ReturnType<typeof adminSearchMlmReportUsers>>, TError = ErrorType<unknown>>(params: AdminSearchMlmReportUsersParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminSearchMlmReportUsers>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Builds a downline tree up to `depth` levels deep (default 3, max 6).
Useful for power users who need to audit beyond the standard 3-level
commission window.

 * @summary Get a multi-level MLM referral report rooted at a user.
 */
export declare const getAdminGetMlmReportUrl: (userId: string, params?: AdminGetMlmReportParams) => string;
export declare const adminGetMlmReport: (userId: string, params?: AdminGetMlmReportParams, options?: RequestInit) => Promise<MlmReportResponse>;
export declare const getAdminGetMlmReportQueryKey: (userId: string, params?: AdminGetMlmReportParams) => readonly [`/api/admin/mlm-report/${string}`, ...AdminGetMlmReportParams[]];
export declare const getAdminGetMlmReportQueryOptions: <TData = Awaited<ReturnType<typeof adminGetMlmReport>>, TError = ErrorType<ErrorEnvelope>>(userId: string, params?: AdminGetMlmReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetMlmReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminGetMlmReport>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminGetMlmReportQueryResult = NonNullable<Awaited<ReturnType<typeof adminGetMlmReport>>>;
export type AdminGetMlmReportQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Get a multi-level MLM referral report rooted at a user.
 */
export declare function useAdminGetMlmReport<TData = Awaited<ReturnType<typeof adminGetMlmReport>>, TError = ErrorType<ErrorEnvelope>>(userId: string, params?: AdminGetMlmReportParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetMlmReport>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Returns every referral_earnings row credited to the given user
(newest first), so admins can audit which rides drove their earnings
from the MLM report drill-down.

 * @summary Per-ride referral earnings for a specific downline member.
 */
export declare const getAdminGetMlmReportUserEarningsUrl: (userId: string) => string;
export declare const adminGetMlmReportUserEarnings: (userId: string, options?: RequestInit) => Promise<MlmReportUserEarningsResponse>;
export declare const getAdminGetMlmReportUserEarningsQueryKey: (userId: string) => readonly [`/api/admin/mlm-report/${string}/earnings`];
export declare const getAdminGetMlmReportUserEarningsQueryOptions: <TData = Awaited<ReturnType<typeof adminGetMlmReportUserEarnings>>, TError = ErrorType<ErrorEnvelope>>(userId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetMlmReportUserEarnings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminGetMlmReportUserEarnings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminGetMlmReportUserEarningsQueryResult = NonNullable<Awaited<ReturnType<typeof adminGetMlmReportUserEarnings>>>;
export type AdminGetMlmReportUserEarningsQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Per-ride referral earnings for a specific downline member.
 */
export declare function useAdminGetMlmReportUserEarnings<TData = Awaited<ReturnType<typeof adminGetMlmReportUserEarnings>>, TError = ErrorType<ErrorEnvelope>>(userId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetMlmReportUserEarnings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List the configured referral levels.
 */
export declare const getAdminListReferralLevelsUrl: () => string;
export declare const adminListReferralLevels: (options?: RequestInit) => Promise<AdminListReferralLevels200>;
export declare const getAdminListReferralLevelsQueryKey: () => readonly ["/api/admin/referral-levels"];
export declare const getAdminListReferralLevelsQueryOptions: <TData = Awaited<ReturnType<typeof adminListReferralLevels>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListReferralLevels>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminListReferralLevels>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminListReferralLevelsQueryResult = NonNullable<Awaited<ReturnType<typeof adminListReferralLevels>>>;
export type AdminListReferralLevelsQueryError = ErrorType<unknown>;
/**
 * @summary List the configured referral levels.
 */
export declare function useAdminListReferralLevels<TData = Awaited<ReturnType<typeof adminListReferralLevels>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListReferralLevels>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update one referral level (1, 2 or 3).
 */
export declare const getAdminUpsertReferralLevelUrl: (level: number) => string;
export declare const adminUpsertReferralLevel: (level: number, updateReferralLevelRequest: UpdateReferralLevelRequest, options?: RequestInit) => Promise<AdminUpsertReferralLevel200>;
export declare const getAdminUpsertReferralLevelMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpsertReferralLevel>>, TError, {
        level: number;
        data: BodyType<UpdateReferralLevelRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminUpsertReferralLevel>>, TError, {
    level: number;
    data: BodyType<UpdateReferralLevelRequest>;
}, TContext>;
export type AdminUpsertReferralLevelMutationResult = NonNullable<Awaited<ReturnType<typeof adminUpsertReferralLevel>>>;
export type AdminUpsertReferralLevelMutationBody = BodyType<UpdateReferralLevelRequest>;
export type AdminUpsertReferralLevelMutationError = ErrorType<unknown>;
/**
 * @summary Update one referral level (1, 2 or 3).
 */
export declare const useAdminUpsertReferralLevel: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpsertReferralLevel>>, TError, {
        level: number;
        data: BodyType<UpdateReferralLevelRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminUpsertReferralLevel>>, TError, {
    level: number;
    data: BodyType<UpdateReferralLevelRequest>;
}, TContext>;
/**
 * @summary List referral earnings with optional date / level / user / ride filters.
 */
export declare const getAdminListReferralEarningsUrl: (params?: AdminListReferralEarningsParams) => string;
export declare const adminListReferralEarnings: (params?: AdminListReferralEarningsParams, options?: RequestInit) => Promise<ReferralEarningsListResponse>;
export declare const getAdminListReferralEarningsQueryKey: (params?: AdminListReferralEarningsParams) => readonly ["/api/admin/referral-earnings", ...AdminListReferralEarningsParams[]];
export declare const getAdminListReferralEarningsQueryOptions: <TData = Awaited<ReturnType<typeof adminListReferralEarnings>>, TError = ErrorType<unknown>>(params?: AdminListReferralEarningsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListReferralEarnings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminListReferralEarnings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminListReferralEarningsQueryResult = NonNullable<Awaited<ReturnType<typeof adminListReferralEarnings>>>;
export type AdminListReferralEarningsQueryError = ErrorType<unknown>;
/**
 * @summary List referral earnings with optional date / level / user / ride filters.
 */
export declare function useAdminListReferralEarnings<TData = Awaited<ReturnType<typeof adminListReferralEarnings>>, TError = ErrorType<unknown>>(params?: AdminListReferralEarningsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListReferralEarnings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Aggregate totals (overall and per level) honoring the same filters as list.
 */
export declare const getAdminReferralEarningsSummaryUrl: (params?: AdminReferralEarningsSummaryParams) => string;
export declare const adminReferralEarningsSummary: (params?: AdminReferralEarningsSummaryParams, options?: RequestInit) => Promise<ReferralEarningsSummaryResponse>;
export declare const getAdminReferralEarningsSummaryQueryKey: (params?: AdminReferralEarningsSummaryParams) => readonly ["/api/admin/referral-earnings/summary", ...AdminReferralEarningsSummaryParams[]];
export declare const getAdminReferralEarningsSummaryQueryOptions: <TData = Awaited<ReturnType<typeof adminReferralEarningsSummary>>, TError = ErrorType<unknown>>(params?: AdminReferralEarningsSummaryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminReferralEarningsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminReferralEarningsSummary>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminReferralEarningsSummaryQueryResult = NonNullable<Awaited<ReturnType<typeof adminReferralEarningsSummary>>>;
export type AdminReferralEarningsSummaryQueryError = ErrorType<unknown>;
/**
 * @summary Aggregate totals (overall and per level) honoring the same filters as list.
 */
export declare function useAdminReferralEarningsSummary<TData = Awaited<ReturnType<typeof adminReferralEarningsSummary>>, TError = ErrorType<unknown>>(params?: AdminReferralEarningsSummaryParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminReferralEarningsSummary>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Check whether an email is already registered.
 */
export declare const getCheckEmailUrl: () => string;
export declare const checkEmail: (checkEmailRequest: CheckEmailRequest, options?: RequestInit) => Promise<EmailExistsResult>;
export declare const getCheckEmailMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof checkEmail>>, TError, {
        data: BodyType<CheckEmailRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof checkEmail>>, TError, {
    data: BodyType<CheckEmailRequest>;
}, TContext>;
export type CheckEmailMutationResult = NonNullable<Awaited<ReturnType<typeof checkEmail>>>;
export type CheckEmailMutationBody = BodyType<CheckEmailRequest>;
export type CheckEmailMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Check whether an email is already registered.
 */
export declare const useCheckEmail: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof checkEmail>>, TError, {
        data: BodyType<CheckEmailRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof checkEmail>>, TError, {
    data: BodyType<CheckEmailRequest>;
}, TContext>;
/**
 * Verifies the bcrypt-hashed password and returns a session token. Used
by both the riders and drivers app for non-OTP sign-in.

 * @summary Sign in with email and password.
 */
export declare const getPasswordLoginUrl: () => string;
export declare const passwordLogin: (passwordLoginRequest: PasswordLoginRequest, options?: RequestInit) => Promise<AuthSession>;
export declare const getPasswordLoginMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof passwordLogin>>, TError, {
        data: BodyType<PasswordLoginRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof passwordLogin>>, TError, {
    data: BodyType<PasswordLoginRequest>;
}, TContext>;
export type PasswordLoginMutationResult = NonNullable<Awaited<ReturnType<typeof passwordLogin>>>;
export type PasswordLoginMutationBody = BodyType<PasswordLoginRequest>;
export type PasswordLoginMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Sign in with email and password.
 */
export declare const usePasswordLogin: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof passwordLogin>>, TError, {
        data: BodyType<PasswordLoginRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof passwordLogin>>, TError, {
    data: BodyType<PasswordLoginRequest>;
}, TContext>;
/**
 * Used by the new signup wizard and by the legacy "complete profile"
prompt for users who originally signed up with phone-only OTP. Requires
a valid bearer token from a previous OTP verification.

 * @summary Set email + password (and optional referral) for a phone-only account.
 */
export declare const getCompleteProfileUrl: () => string;
export declare const completeProfile: (completeProfileRequest: CompleteProfileRequest, options?: RequestInit) => Promise<AuthMe>;
export declare const getCompleteProfileMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeProfile>>, TError, {
        data: BodyType<CompleteProfileRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof completeProfile>>, TError, {
    data: BodyType<CompleteProfileRequest>;
}, TContext>;
export type CompleteProfileMutationResult = NonNullable<Awaited<ReturnType<typeof completeProfile>>>;
export type CompleteProfileMutationBody = BodyType<CompleteProfileRequest>;
export type CompleteProfileMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Set email + password (and optional referral) for a phone-only account.
 */
export declare const useCompleteProfile: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof completeProfile>>, TError, {
        data: BodyType<CompleteProfileRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof completeProfile>>, TError, {
    data: BodyType<CompleteProfileRequest>;
}, TContext>;
/**
 * @summary Public site-wide settings (brand, social, maintenance).
 */
export declare const getGetSiteSettingsUrl: () => string;
export declare const getSiteSettings: (options?: RequestInit) => Promise<GetSiteSettings200>;
export declare const getGetSiteSettingsQueryKey: () => readonly ["/api/site/settings"];
export declare const getGetSiteSettingsQueryOptions: <TData = Awaited<ReturnType<typeof getSiteSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSiteSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSiteSettings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSiteSettingsQueryResult = NonNullable<Awaited<ReturnType<typeof getSiteSettings>>>;
export type GetSiteSettingsQueryError = ErrorType<unknown>;
/**
 * @summary Public site-wide settings (brand, social, maintenance).
 */
export declare function useGetSiteSettings<TData = Awaited<ReturnType<typeof getSiteSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSiteSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary List published site pages for the given language.
 */
export declare const getListSitePagesUrl: (params?: ListSitePagesParams) => string;
export declare const listSitePages: (params?: ListSitePagesParams, options?: RequestInit) => Promise<ListSitePages200>;
export declare const getListSitePagesQueryKey: (params?: ListSitePagesParams) => readonly ["/api/site/pages", ...ListSitePagesParams[]];
export declare const getListSitePagesQueryOptions: <TData = Awaited<ReturnType<typeof listSitePages>>, TError = ErrorType<unknown>>(params?: ListSitePagesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSitePages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listSitePages>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListSitePagesQueryResult = NonNullable<Awaited<ReturnType<typeof listSitePages>>>;
export type ListSitePagesQueryError = ErrorType<unknown>;
/**
 * @summary List published site pages for the given language.
 */
export declare function useListSitePages<TData = Awaited<ReturnType<typeof listSitePages>>, TError = ErrorType<unknown>>(params?: ListSitePagesParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listSitePages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Fetch a single published site page by language + slug.
 */
export declare const getGetSitePageBySlugUrl: (lang: "en" | "fr" | "ar", slug: string) => string;
export declare const getSitePageBySlug: (lang: "en" | "fr" | "ar", slug: string, options?: RequestInit) => Promise<GetSitePageBySlug200>;
export declare const getGetSitePageBySlugQueryKey: (lang: "en" | "fr" | "ar", slug: string) => readonly [`/api/site/pages/en/${string}` | `/api/site/pages/fr/${string}` | `/api/site/pages/ar/${string}`];
export declare const getGetSitePageBySlugQueryOptions: <TData = Awaited<ReturnType<typeof getSitePageBySlug>>, TError = ErrorType<ErrorEnvelope>>(lang: "en" | "fr" | "ar", slug: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSitePageBySlug>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getSitePageBySlug>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetSitePageBySlugQueryResult = NonNullable<Awaited<ReturnType<typeof getSitePageBySlug>>>;
export type GetSitePageBySlugQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Fetch a single published site page by language + slug.
 */
export declare function useGetSitePageBySlug<TData = Awaited<ReturnType<typeof getSitePageBySlug>>, TError = ErrorType<ErrorEnvelope>>(lang: "en" | "fr" | "ar", slug: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getSitePageBySlug>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Submit a contact form message from the marketing site.
 */
export declare const getPostSiteContactUrl: () => string;
export declare const postSiteContact: (siteContactRequest: SiteContactRequest, options?: RequestInit) => Promise<SiteContactResponse>;
export declare const getPostSiteContactMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof postSiteContact>>, TError, {
        data: BodyType<SiteContactRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof postSiteContact>>, TError, {
    data: BodyType<SiteContactRequest>;
}, TContext>;
export type PostSiteContactMutationResult = NonNullable<Awaited<ReturnType<typeof postSiteContact>>>;
export type PostSiteContactMutationBody = BodyType<SiteContactRequest>;
export type PostSiteContactMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Submit a contact form message from the marketing site.
 */
export declare const usePostSiteContact: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof postSiteContact>>, TError, {
        data: BodyType<SiteContactRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof postSiteContact>>, TError, {
    data: BodyType<SiteContactRequest>;
}, TContext>;
/**
 * @summary List all CMS pages (admin-only).
 */
export declare const getAdminListSitePagesUrl: () => string;
export declare const adminListSitePages: (options?: RequestInit) => Promise<AdminListSitePages200>;
export declare const getAdminListSitePagesQueryKey: () => readonly ["/api/admin/site/pages"];
export declare const getAdminListSitePagesQueryOptions: <TData = Awaited<ReturnType<typeof adminListSitePages>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListSitePages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminListSitePages>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminListSitePagesQueryResult = NonNullable<Awaited<ReturnType<typeof adminListSitePages>>>;
export type AdminListSitePagesQueryError = ErrorType<unknown>;
/**
 * @summary List all CMS pages (admin-only).
 */
export declare function useAdminListSitePages<TData = Awaited<ReturnType<typeof adminListSitePages>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListSitePages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Create a new CMS page.
 */
export declare const getAdminCreateSitePageUrl: () => string;
export declare const adminCreateSitePage: (adminSitePageUpsert: AdminSitePageUpsert, options?: RequestInit) => Promise<AdminCreateSitePage201>;
export declare const getAdminCreateSitePageMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminCreateSitePage>>, TError, {
        data: BodyType<AdminSitePageUpsert>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminCreateSitePage>>, TError, {
    data: BodyType<AdminSitePageUpsert>;
}, TContext>;
export type AdminCreateSitePageMutationResult = NonNullable<Awaited<ReturnType<typeof adminCreateSitePage>>>;
export type AdminCreateSitePageMutationBody = BodyType<AdminSitePageUpsert>;
export type AdminCreateSitePageMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Create a new CMS page.
 */
export declare const useAdminCreateSitePage: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminCreateSitePage>>, TError, {
        data: BodyType<AdminSitePageUpsert>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminCreateSitePage>>, TError, {
    data: BodyType<AdminSitePageUpsert>;
}, TContext>;
/**
 * @summary Fetch a single CMS page (any status).
 */
export declare const getAdminGetSitePageUrl: (slug: string, lang: "en" | "fr" | "ar") => string;
export declare const adminGetSitePage: (slug: string, lang: "en" | "fr" | "ar", options?: RequestInit) => Promise<AdminGetSitePage200>;
export declare const getAdminGetSitePageQueryKey: (slug: string, lang: "en" | "fr" | "ar") => readonly [`/api/admin/site/pages/${string}/en` | `/api/admin/site/pages/${string}/fr` | `/api/admin/site/pages/${string}/ar`];
export declare const getAdminGetSitePageQueryOptions: <TData = Awaited<ReturnType<typeof adminGetSitePage>>, TError = ErrorType<ErrorEnvelope>>(slug: string, lang: "en" | "fr" | "ar", options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetSitePage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminGetSitePage>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminGetSitePageQueryResult = NonNullable<Awaited<ReturnType<typeof adminGetSitePage>>>;
export type AdminGetSitePageQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Fetch a single CMS page (any status).
 */
export declare function useAdminGetSitePage<TData = Awaited<ReturnType<typeof adminGetSitePage>>, TError = ErrorType<ErrorEnvelope>>(slug: string, lang: "en" | "fr" | "ar", options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetSitePage>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update an existing CMS page.
 */
export declare const getAdminUpdateSitePageUrl: (slug: string, lang: "en" | "fr" | "ar") => string;
export declare const adminUpdateSitePage: (slug: string, lang: "en" | "fr" | "ar", adminSitePageUpsert: AdminSitePageUpsert, options?: RequestInit) => Promise<AdminUpdateSitePage200>;
export declare const getAdminUpdateSitePageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateSitePage>>, TError, {
        slug: string;
        lang: "en" | "fr" | "ar";
        data: BodyType<AdminSitePageUpsert>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminUpdateSitePage>>, TError, {
    slug: string;
    lang: "en" | "fr" | "ar";
    data: BodyType<AdminSitePageUpsert>;
}, TContext>;
export type AdminUpdateSitePageMutationResult = NonNullable<Awaited<ReturnType<typeof adminUpdateSitePage>>>;
export type AdminUpdateSitePageMutationBody = BodyType<AdminSitePageUpsert>;
export type AdminUpdateSitePageMutationError = ErrorType<unknown>;
/**
 * @summary Update an existing CMS page.
 */
export declare const useAdminUpdateSitePage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateSitePage>>, TError, {
        slug: string;
        lang: "en" | "fr" | "ar";
        data: BodyType<AdminSitePageUpsert>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminUpdateSitePage>>, TError, {
    slug: string;
    lang: "en" | "fr" | "ar";
    data: BodyType<AdminSitePageUpsert>;
}, TContext>;
/**
 * @summary Delete a CMS page.
 */
export declare const getAdminDeleteSitePageUrl: (slug: string, lang: "en" | "fr" | "ar") => string;
export declare const adminDeleteSitePage: (slug: string, lang: "en" | "fr" | "ar", options?: RequestInit) => Promise<AdminDeleteSitePage200>;
export declare const getAdminDeleteSitePageMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminDeleteSitePage>>, TError, {
        slug: string;
        lang: "en" | "fr" | "ar";
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminDeleteSitePage>>, TError, {
    slug: string;
    lang: "en" | "fr" | "ar";
}, TContext>;
export type AdminDeleteSitePageMutationResult = NonNullable<Awaited<ReturnType<typeof adminDeleteSitePage>>>;
export type AdminDeleteSitePageMutationError = ErrorType<unknown>;
/**
 * @summary Delete a CMS page.
 */
export declare const useAdminDeleteSitePage: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminDeleteSitePage>>, TError, {
        slug: string;
        lang: "en" | "fr" | "ar";
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminDeleteSitePage>>, TError, {
    slug: string;
    lang: "en" | "fr" | "ar";
}, TContext>;
/**
 * @summary Read full site-wide settings (admin).
 */
export declare const getAdminGetSiteSettingsUrl: () => string;
export declare const adminGetSiteSettings: (options?: RequestInit) => Promise<AdminGetSiteSettings200>;
export declare const getAdminGetSiteSettingsQueryKey: () => readonly ["/api/admin/site/settings"];
export declare const getAdminGetSiteSettingsQueryOptions: <TData = Awaited<ReturnType<typeof adminGetSiteSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetSiteSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminGetSiteSettings>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminGetSiteSettingsQueryResult = NonNullable<Awaited<ReturnType<typeof adminGetSiteSettings>>>;
export type AdminGetSiteSettingsQueryError = ErrorType<unknown>;
/**
 * @summary Read full site-wide settings (admin).
 */
export declare function useAdminGetSiteSettings<TData = Awaited<ReturnType<typeof adminGetSiteSettings>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminGetSiteSettings>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update site-wide settings (partial).
 */
export declare const getAdminUpdateSiteSettingsUrl: () => string;
export declare const adminUpdateSiteSettings: (siteSettings: SiteSettings, options?: RequestInit) => Promise<AdminUpdateSiteSettings200>;
export declare const getAdminUpdateSiteSettingsMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateSiteSettings>>, TError, {
        data: BodyType<SiteSettings>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminUpdateSiteSettings>>, TError, {
    data: BodyType<SiteSettings>;
}, TContext>;
export type AdminUpdateSiteSettingsMutationResult = NonNullable<Awaited<ReturnType<typeof adminUpdateSiteSettings>>>;
export type AdminUpdateSiteSettingsMutationBody = BodyType<SiteSettings>;
export type AdminUpdateSiteSettingsMutationError = ErrorType<unknown>;
/**
 * @summary Update site-wide settings (partial).
 */
export declare const useAdminUpdateSiteSettings: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateSiteSettings>>, TError, {
        data: BodyType<SiteSettings>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminUpdateSiteSettings>>, TError, {
    data: BodyType<SiteSettings>;
}, TContext>;
/**
 * @summary Reset password with phone + OTP code (web flow).
 */
export declare const getResetPasswordUrl: () => string;
export declare const resetPassword: (resetPasswordRequest: ResetPasswordRequest, options?: RequestInit) => Promise<ResetPassword200>;
export declare const getResetPasswordMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetPassword>>, TError, {
        data: BodyType<ResetPasswordRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof resetPassword>>, TError, {
    data: BodyType<ResetPasswordRequest>;
}, TContext>;
export type ResetPasswordMutationResult = NonNullable<Awaited<ReturnType<typeof resetPassword>>>;
export type ResetPasswordMutationBody = BodyType<ResetPasswordRequest>;
export type ResetPasswordMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Reset password with phone + OTP code (web flow).
 */
export declare const useResetPassword: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof resetPassword>>, TError, {
        data: BodyType<ResetPasswordRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof resetPassword>>, TError, {
    data: BodyType<ResetPasswordRequest>;
}, TContext>;
/**
 * @summary List contact form submissions.
 */
export declare const getAdminListContactSubmissionsUrl: (params?: AdminListContactSubmissionsParams) => string;
export declare const adminListContactSubmissions: (params?: AdminListContactSubmissionsParams, options?: RequestInit) => Promise<AdminListContactSubmissions200>;
export declare const getAdminListContactSubmissionsQueryKey: (params?: AdminListContactSubmissionsParams) => readonly ["/api/admin/site/contact-submissions", ...AdminListContactSubmissionsParams[]];
export declare const getAdminListContactSubmissionsQueryOptions: <TData = Awaited<ReturnType<typeof adminListContactSubmissions>>, TError = ErrorType<unknown>>(params?: AdminListContactSubmissionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListContactSubmissions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminListContactSubmissions>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminListContactSubmissionsQueryResult = NonNullable<Awaited<ReturnType<typeof adminListContactSubmissions>>>;
export type AdminListContactSubmissionsQueryError = ErrorType<unknown>;
/**
 * @summary List contact form submissions.
 */
export declare function useAdminListContactSubmissions<TData = Awaited<ReturnType<typeof adminListContactSubmissions>>, TError = ErrorType<unknown>>(params?: AdminListContactSubmissionsParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListContactSubmissions>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update a contact submission's status (new/read/archived).
 */
export declare const getAdminUpdateContactSubmissionUrl: (id: string) => string;
export declare const adminUpdateContactSubmission: (id: string, adminContactSubmissionUpdate: AdminContactSubmissionUpdate, options?: RequestInit) => Promise<AdminUpdateContactSubmission200>;
export declare const getAdminUpdateContactSubmissionMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateContactSubmission>>, TError, {
        id: string;
        data: BodyType<AdminContactSubmissionUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminUpdateContactSubmission>>, TError, {
    id: string;
    data: BodyType<AdminContactSubmissionUpdate>;
}, TContext>;
export type AdminUpdateContactSubmissionMutationResult = NonNullable<Awaited<ReturnType<typeof adminUpdateContactSubmission>>>;
export type AdminUpdateContactSubmissionMutationBody = BodyType<AdminContactSubmissionUpdate>;
export type AdminUpdateContactSubmissionMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Update a contact submission's status (new/read/archived).
 */
export declare const useAdminUpdateContactSubmission: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateContactSubmission>>, TError, {
        id: string;
        data: BodyType<AdminContactSubmissionUpdate>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminUpdateContactSubmission>>, TError, {
    id: string;
    data: BodyType<AdminContactSubmissionUpdate>;
}, TContext>;
/**
 * @summary Delete a contact submission.
 */
export declare const getAdminDeleteContactSubmissionUrl: (id: string) => string;
export declare const adminDeleteContactSubmission: (id: string, options?: RequestInit) => Promise<AdminDeleteContactSubmission200>;
export declare const getAdminDeleteContactSubmissionMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminDeleteContactSubmission>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminDeleteContactSubmission>>, TError, {
    id: string;
}, TContext>;
export type AdminDeleteContactSubmissionMutationResult = NonNullable<Awaited<ReturnType<typeof adminDeleteContactSubmission>>>;
export type AdminDeleteContactSubmissionMutationError = ErrorType<unknown>;
/**
 * @summary Delete a contact submission.
 */
export declare const useAdminDeleteContactSubmission: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminDeleteContactSubmission>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminDeleteContactSubmission>>, TError, {
    id: string;
}, TContext>;
/**
 * @summary List uploaded sounds plus the current mobile build hash.
 */
export declare const getAdminListNotificationSoundsUrl: () => string;
export declare const adminListNotificationSounds: (options?: RequestInit) => Promise<AdminNotificationSoundsListResponse>;
export declare const getAdminListNotificationSoundsQueryKey: () => readonly ["/api/admin/notification-sounds"];
export declare const getAdminListNotificationSoundsQueryOptions: <TData = Awaited<ReturnType<typeof adminListNotificationSounds>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListNotificationSounds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof adminListNotificationSounds>>, TError, TData> & {
    queryKey: QueryKey;
};
export type AdminListNotificationSoundsQueryResult = NonNullable<Awaited<ReturnType<typeof adminListNotificationSounds>>>;
export type AdminListNotificationSoundsQueryError = ErrorType<unknown>;
/**
 * @summary List uploaded sounds plus the current mobile build hash.
 */
export declare function useAdminListNotificationSounds<TData = Awaited<ReturnType<typeof adminListNotificationSounds>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof adminListNotificationSounds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Request a presigned upload URL for a notification sound (audio-only, max 1 MB).
 */
export declare const getAdminRequestNotificationSoundUploadUrlUrl: () => string;
export declare const adminRequestNotificationSoundUploadUrl: (notificationSoundUploadUrlRequest: NotificationSoundUploadUrlRequest, options?: RequestInit) => Promise<UploadUrlResponse>;
export declare const getAdminRequestNotificationSoundUploadUrlMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminRequestNotificationSoundUploadUrl>>, TError, {
        data: BodyType<NotificationSoundUploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminRequestNotificationSoundUploadUrl>>, TError, {
    data: BodyType<NotificationSoundUploadUrlRequest>;
}, TContext>;
export type AdminRequestNotificationSoundUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof adminRequestNotificationSoundUploadUrl>>>;
export type AdminRequestNotificationSoundUploadUrlMutationBody = BodyType<NotificationSoundUploadUrlRequest>;
export type AdminRequestNotificationSoundUploadUrlMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Request a presigned upload URL for a notification sound (audio-only, max 1 MB).
 */
export declare const useAdminRequestNotificationSoundUploadUrl: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminRequestNotificationSoundUploadUrl>>, TError, {
        data: BodyType<NotificationSoundUploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminRequestNotificationSoundUploadUrl>>, TError, {
    data: BodyType<NotificationSoundUploadUrlRequest>;
}, TContext>;
/**
 * @summary Mark an uploaded object public and create the library row.
 */
export declare const getAdminFinalizeNotificationSoundUrl: () => string;
export declare const adminFinalizeNotificationSound: (finalizeNotificationSoundRequest: FinalizeNotificationSoundRequest, options?: RequestInit) => Promise<AdminFinalizeNotificationSound200>;
export declare const getAdminFinalizeNotificationSoundMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminFinalizeNotificationSound>>, TError, {
        data: BodyType<FinalizeNotificationSoundRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminFinalizeNotificationSound>>, TError, {
    data: BodyType<FinalizeNotificationSoundRequest>;
}, TContext>;
export type AdminFinalizeNotificationSoundMutationResult = NonNullable<Awaited<ReturnType<typeof adminFinalizeNotificationSound>>>;
export type AdminFinalizeNotificationSoundMutationBody = BodyType<FinalizeNotificationSoundRequest>;
export type AdminFinalizeNotificationSoundMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Mark an uploaded object public and create the library row.
 */
export declare const useAdminFinalizeNotificationSound: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminFinalizeNotificationSound>>, TError, {
        data: BodyType<FinalizeNotificationSoundRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminFinalizeNotificationSound>>, TError, {
    data: BodyType<FinalizeNotificationSoundRequest>;
}, TContext>;
/**
 * @summary Rename a notification sound.
 */
export declare const getAdminRenameNotificationSoundUrl: (id: string) => string;
export declare const adminRenameNotificationSound: (id: string, renameNotificationSoundRequest: RenameNotificationSoundRequest, options?: RequestInit) => Promise<OkResponse>;
export declare const getAdminRenameNotificationSoundMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminRenameNotificationSound>>, TError, {
        id: string;
        data: BodyType<RenameNotificationSoundRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminRenameNotificationSound>>, TError, {
    id: string;
    data: BodyType<RenameNotificationSoundRequest>;
}, TContext>;
export type AdminRenameNotificationSoundMutationResult = NonNullable<Awaited<ReturnType<typeof adminRenameNotificationSound>>>;
export type AdminRenameNotificationSoundMutationBody = BodyType<RenameNotificationSoundRequest>;
export type AdminRenameNotificationSoundMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Rename a notification sound.
 */
export declare const useAdminRenameNotificationSound: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminRenameNotificationSound>>, TError, {
        id: string;
        data: BodyType<RenameNotificationSoundRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminRenameNotificationSound>>, TError, {
    id: string;
    data: BodyType<RenameNotificationSoundRequest>;
}, TContext>;
/**
 * @summary Delete a notification sound (rejects if currently assigned).
 */
export declare const getAdminDeleteNotificationSoundUrl: (id: string) => string;
export declare const adminDeleteNotificationSound: (id: string, options?: RequestInit) => Promise<OkResponse>;
export declare const getAdminDeleteNotificationSoundMutationOptions: <TError = ErrorType<ErrorEnvelope | SoundInUseError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminDeleteNotificationSound>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminDeleteNotificationSound>>, TError, {
    id: string;
}, TContext>;
export type AdminDeleteNotificationSoundMutationResult = NonNullable<Awaited<ReturnType<typeof adminDeleteNotificationSound>>>;
export type AdminDeleteNotificationSoundMutationError = ErrorType<ErrorEnvelope | SoundInUseError>;
/**
 * @summary Delete a notification sound (rejects if currently assigned).
 */
export declare const useAdminDeleteNotificationSound: <TError = ErrorType<ErrorEnvelope | SoundInUseError>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminDeleteNotificationSound>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminDeleteNotificationSound>>, TError, {
    id: string;
}, TContext>;
/**
 * @summary Record the manifest hash and bundled sounds for the current mobile build.
 */
export declare const getAdminUpdateNotificationSoundsBuildHashUrl: () => string;
export declare const adminUpdateNotificationSoundsBuildHash: (updateBuildHashRequest: UpdateBuildHashRequest, options?: RequestInit) => Promise<OkResponse>;
export declare const getAdminUpdateNotificationSoundsBuildHashMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateNotificationSoundsBuildHash>>, TError, {
        data: BodyType<UpdateBuildHashRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof adminUpdateNotificationSoundsBuildHash>>, TError, {
    data: BodyType<UpdateBuildHashRequest>;
}, TContext>;
export type AdminUpdateNotificationSoundsBuildHashMutationResult = NonNullable<Awaited<ReturnType<typeof adminUpdateNotificationSoundsBuildHash>>>;
export type AdminUpdateNotificationSoundsBuildHashMutationBody = BodyType<UpdateBuildHashRequest>;
export type AdminUpdateNotificationSoundsBuildHashMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Record the manifest hash and bundled sounds for the current mobile build.
 */
export declare const useAdminUpdateNotificationSoundsBuildHash: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof adminUpdateNotificationSoundsBuildHash>>, TError, {
        data: BodyType<UpdateBuildHashRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof adminUpdateNotificationSoundsBuildHash>>, TError, {
    data: BodyType<UpdateBuildHashRequest>;
}, TContext>;
/**
 * @summary Public manifest of every uploaded notification sound.
 */
export declare const getGetNotificationSoundsManifestUrl: () => string;
export declare const getNotificationSoundsManifest: (options?: RequestInit) => Promise<NotificationSoundsManifestResponse>;
export declare const getGetNotificationSoundsManifestQueryKey: () => readonly ["/api/notification-sounds/manifest"];
export declare const getGetNotificationSoundsManifestQueryOptions: <TData = Awaited<ReturnType<typeof getNotificationSoundsManifest>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotificationSoundsManifest>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getNotificationSoundsManifest>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetNotificationSoundsManifestQueryResult = NonNullable<Awaited<ReturnType<typeof getNotificationSoundsManifest>>>;
export type GetNotificationSoundsManifestQueryError = ErrorType<unknown>;
/**
 * @summary Public manifest of every uploaded notification sound.
 */
export declare function useGetNotificationSoundsManifest<TData = Awaited<ReturnType<typeof getNotificationSoundsManifest>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getNotificationSoundsManifest>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Public mapping of category to active slug plus manifest.
 */
export declare const getGetActiveNotificationSoundsUrl: () => string;
export declare const getActiveNotificationSounds: (options?: RequestInit) => Promise<ActiveNotificationSoundsResponse>;
export declare const getGetActiveNotificationSoundsQueryKey: () => readonly ["/api/notification-sounds/active"];
export declare const getGetActiveNotificationSoundsQueryOptions: <TData = Awaited<ReturnType<typeof getActiveNotificationSounds>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getActiveNotificationSounds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getActiveNotificationSounds>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetActiveNotificationSoundsQueryResult = NonNullable<Awaited<ReturnType<typeof getActiveNotificationSounds>>>;
export type GetActiveNotificationSoundsQueryError = ErrorType<unknown>;
/**
 * @summary Public mapping of category to active slug plus manifest.
 */
export declare function useGetActiveNotificationSounds<TData = Awaited<ReturnType<typeof getActiveNotificationSounds>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getActiveNotificationSounds>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Returns server health status
 * @summary Health check
 */
export declare const getHealthCheckUrl: () => string;
export declare const healthCheck: (options?: RequestInit) => Promise<HealthStatus>;
export declare const getHealthCheckQueryKey: () => readonly ["/api/healthz"];
export declare const getHealthCheckQueryOptions: <TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData> & {
    queryKey: QueryKey;
};
export type HealthCheckQueryResult = NonNullable<Awaited<ReturnType<typeof healthCheck>>>;
export type HealthCheckQueryError = ErrorType<unknown>;
/**
 * @summary Health check
 */
export declare function useHealthCheck<TData = Awaited<ReturnType<typeof healthCheck>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof healthCheck>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Returns a presigned GCS URL for direct upload. The client sends JSON
metadata here, then uploads the file directly to the returned URL.

 * @summary Request a presigned URL for file upload
 */
export declare const getRequestUploadUrlUrl: () => string;
export declare const requestUploadUrl: (uploadUrlRequest: UploadUrlRequest, options?: RequestInit) => Promise<UploadUrlResponse>;
export declare const getRequestUploadUrlMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
        data: BodyType<UploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
    data: BodyType<UploadUrlRequest>;
}, TContext>;
export type RequestUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof requestUploadUrl>>>;
export type RequestUploadUrlMutationBody = BodyType<UploadUrlRequest>;
export type RequestUploadUrlMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Request a presigned URL for file upload
 */
export declare const useRequestUploadUrl: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
        data: BodyType<UploadUrlRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestUploadUrl>>, TError, {
    data: BodyType<UploadUrlRequest>;
}, TContext>;
/**
 * Unconditionally public — no authentication or ACL checks.
Searches PUBLIC_OBJECT_SEARCH_PATHS for the given file path.

 * @summary Serve a public asset from PUBLIC_OBJECT_SEARCH_PATHS
 */
export declare const getGetPublicObjectUrl: (filePath: string) => string;
export declare const getPublicObject: (filePath: string, options?: RequestInit) => Promise<Blob>;
export declare const getGetPublicObjectQueryKey: (filePath: string) => readonly [`/api/storage/public-objects/${string}`];
export declare const getGetPublicObjectQueryOptions: <TData = Awaited<ReturnType<typeof getPublicObject>>, TError = ErrorType<ErrorEnvelope>>(filePath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPublicObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getPublicObject>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetPublicObjectQueryResult = NonNullable<Awaited<ReturnType<typeof getPublicObject>>>;
export type GetPublicObjectQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Serve a public asset from PUBLIC_OBJECT_SEARCH_PATHS
 */
export declare function useGetPublicObject<TData = Awaited<ReturnType<typeof getPublicObject>>, TError = ErrorType<ErrorEnvelope>>(filePath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getPublicObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Serves object entities uploaded via presigned URLs. These can optionally
be protected with authentication or ACL checks based on the use case.

 * @summary Serve an object entity from PRIVATE_OBJECT_DIR
 */
export declare const getGetStorageObjectUrl: (objectPath: string) => string;
export declare const getStorageObject: (objectPath: string, options?: RequestInit) => Promise<Blob>;
export declare const getGetStorageObjectQueryKey: (objectPath: string) => readonly [`/api/storage/objects/${string}`];
export declare const getGetStorageObjectQueryOptions: <TData = Awaited<ReturnType<typeof getStorageObject>>, TError = ErrorType<ErrorEnvelope>>(objectPath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStorageObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getStorageObject>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetStorageObjectQueryResult = NonNullable<Awaited<ReturnType<typeof getStorageObject>>>;
export type GetStorageObjectQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Serve an object entity from PRIVATE_OBJECT_DIR
 */
export declare function useGetStorageObject<TData = Awaited<ReturnType<typeof getStorageObject>>, TError = ErrorType<ErrorEnvelope>>(objectPath: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getStorageObject>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Returns ride candidates whose pickup is near the driver's current dropoff,
eligible to be queued as the driver's next trip. Also returns any ride the
driver has already queued.

 * @summary List queued ride candidates and the driver's currently queued ride
 */
export declare const getGetDriverQueuedRequestsUrl: () => string;
export declare const getDriverQueuedRequests: (options?: RequestInit) => Promise<GetDriverQueuedRequests200>;
export declare const getGetDriverQueuedRequestsQueryKey: () => readonly ["/api/driver/queued-requests"];
export declare const getGetDriverQueuedRequestsQueryOptions: <TData = Awaited<ReturnType<typeof getDriverQueuedRequests>>, TError = ErrorType<ErrorEnvelope>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDriverQueuedRequests>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDriverQueuedRequests>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDriverQueuedRequestsQueryResult = NonNullable<Awaited<ReturnType<typeof getDriverQueuedRequests>>>;
export type GetDriverQueuedRequestsQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary List queued ride candidates and the driver's currently queued ride
 */
export declare function useGetDriverQueuedRequests<TData = Awaited<ReturnType<typeof getDriverQueuedRequests>>, TError = ErrorType<ErrorEnvelope>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDriverQueuedRequests>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Accept a queued ride request
 */
export declare const getPostDriverQueuedRequestsRideIdAcceptUrl: (rideId: string) => string;
export declare const postDriverQueuedRequestsRideIdAccept: (rideId: string, options?: RequestInit) => Promise<PostDriverQueuedRequestsRideIdAccept200>;
export declare const getPostDriverQueuedRequestsRideIdAcceptMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdAccept>>, TError, {
        rideId: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdAccept>>, TError, {
    rideId: string;
}, TContext>;
export type PostDriverQueuedRequestsRideIdAcceptMutationResult = NonNullable<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdAccept>>>;
export type PostDriverQueuedRequestsRideIdAcceptMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Accept a queued ride request
 */
export declare const usePostDriverQueuedRequestsRideIdAccept: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdAccept>>, TError, {
        rideId: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdAccept>>, TError, {
    rideId: string;
}, TContext>;
/**
 * Internal endpoint used by the driver app as a safety net to re-trigger
activation of an accepted queued ride if the automatic activation
inside `POST /rides/{id}/complete` failed or was missed (e.g. the
client timed out before receiving the response). Restricted to the
driver who completed the trip.

 * @summary Manually re-trigger queued-ride activation after a trip completes
 */
export declare const getActivateNextQueuedRideUrl: () => string;
export declare const activateNextQueuedRide: (activateNextQueuedRideRequest: ActivateNextQueuedRideRequest, options?: RequestInit) => Promise<ActivateNextQueuedRideResult>;
export declare const getActivateNextQueuedRideMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof activateNextQueuedRide>>, TError, {
        data: BodyType<ActivateNextQueuedRideRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof activateNextQueuedRide>>, TError, {
    data: BodyType<ActivateNextQueuedRideRequest>;
}, TContext>;
export type ActivateNextQueuedRideMutationResult = NonNullable<Awaited<ReturnType<typeof activateNextQueuedRide>>>;
export type ActivateNextQueuedRideMutationBody = BodyType<ActivateNextQueuedRideRequest>;
export type ActivateNextQueuedRideMutationError = ErrorType<void>;
/**
 * @summary Manually re-trigger queued-ride activation after a trip completes
 */
export declare const useActivateNextQueuedRide: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof activateNextQueuedRide>>, TError, {
        data: BodyType<ActivateNextQueuedRideRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof activateNextQueuedRide>>, TError, {
    data: BodyType<ActivateNextQueuedRideRequest>;
}, TContext>;
/**
 * @summary Get the driver's current destination mode state and quota
 */
export declare const getGetDriverDestinationModeUrl: () => string;
export declare const getDriverDestinationMode: (options?: RequestInit) => Promise<DestinationModeState>;
export declare const getGetDriverDestinationModeQueryKey: () => readonly ["/api/driver/destination-mode"];
export declare const getGetDriverDestinationModeQueryOptions: <TData = Awaited<ReturnType<typeof getDriverDestinationMode>>, TError = ErrorType<ErrorEnvelope>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDriverDestinationMode>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getDriverDestinationMode>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetDriverDestinationModeQueryResult = NonNullable<Awaited<ReturnType<typeof getDriverDestinationMode>>>;
export type GetDriverDestinationModeQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Get the driver's current destination mode state and quota
 */
export declare function useGetDriverDestinationMode<TData = Awaited<ReturnType<typeof getDriverDestinationMode>>, TError = ErrorType<ErrorEnvelope>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getDriverDestinationMode>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Turn on destination mode toward an address
 */
export declare const getActivateDriverDestinationModeUrl: () => string;
export declare const activateDriverDestinationMode: (activateDestinationModeRequest: ActivateDestinationModeRequest, options?: RequestInit) => Promise<DestinationModeState>;
export declare const getActivateDriverDestinationModeMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof activateDriverDestinationMode>>, TError, {
        data: BodyType<ActivateDestinationModeRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof activateDriverDestinationMode>>, TError, {
    data: BodyType<ActivateDestinationModeRequest>;
}, TContext>;
export type ActivateDriverDestinationModeMutationResult = NonNullable<Awaited<ReturnType<typeof activateDriverDestinationMode>>>;
export type ActivateDriverDestinationModeMutationBody = BodyType<ActivateDestinationModeRequest>;
export type ActivateDriverDestinationModeMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Turn on destination mode toward an address
 */
export declare const useActivateDriverDestinationMode: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof activateDriverDestinationMode>>, TError, {
        data: BodyType<ActivateDestinationModeRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof activateDriverDestinationMode>>, TError, {
    data: BodyType<ActivateDestinationModeRequest>;
}, TContext>;
/**
 * @summary Turn off destination mode
 */
export declare const getDeactivateDriverDestinationModeUrl: () => string;
export declare const deactivateDriverDestinationMode: (options?: RequestInit) => Promise<DestinationModeState>;
export declare const getDeactivateDriverDestinationModeMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deactivateDriverDestinationMode>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deactivateDriverDestinationMode>>, TError, void, TContext>;
export type DeactivateDriverDestinationModeMutationResult = NonNullable<Awaited<ReturnType<typeof deactivateDriverDestinationMode>>>;
export type DeactivateDriverDestinationModeMutationError = ErrorType<unknown>;
/**
 * @summary Turn off destination mode
 */
export declare const useDeactivateDriverDestinationMode: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deactivateDriverDestinationMode>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deactivateDriverDestinationMode>>, TError, void, TContext>;
/**
 * @summary List the driver's saved places (Home/Work) and recents
 */
export declare const getListDriverSavedPlacesUrl: () => string;
export declare const listDriverSavedPlaces: (options?: RequestInit) => Promise<DriverSavedPlacesResponse>;
export declare const getListDriverSavedPlacesQueryKey: () => readonly ["/api/driver/saved-places"];
export declare const getListDriverSavedPlacesQueryOptions: <TData = Awaited<ReturnType<typeof listDriverSavedPlaces>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDriverSavedPlaces>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listDriverSavedPlaces>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListDriverSavedPlacesQueryResult = NonNullable<Awaited<ReturnType<typeof listDriverSavedPlaces>>>;
export type ListDriverSavedPlacesQueryError = ErrorType<unknown>;
/**
 * @summary List the driver's saved places (Home/Work) and recents
 */
export declare function useListDriverSavedPlaces<TData = Awaited<ReturnType<typeof listDriverSavedPlaces>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listDriverSavedPlaces>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Save or upsert a Home/Work/recent place for the driver
 */
export declare const getUpsertDriverSavedPlaceUrl: () => string;
export declare const upsertDriverSavedPlace: (upsertDriverSavedPlaceRequest: UpsertDriverSavedPlaceRequest, options?: RequestInit) => Promise<DriverSavedPlace>;
export declare const getUpsertDriverSavedPlaceMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof upsertDriverSavedPlace>>, TError, {
        data: BodyType<UpsertDriverSavedPlaceRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof upsertDriverSavedPlace>>, TError, {
    data: BodyType<UpsertDriverSavedPlaceRequest>;
}, TContext>;
export type UpsertDriverSavedPlaceMutationResult = NonNullable<Awaited<ReturnType<typeof upsertDriverSavedPlace>>>;
export type UpsertDriverSavedPlaceMutationBody = BodyType<UpsertDriverSavedPlaceRequest>;
export type UpsertDriverSavedPlaceMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Save or upsert a Home/Work/recent place for the driver
 */
export declare const useUpsertDriverSavedPlace: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof upsertDriverSavedPlace>>, TError, {
        data: BodyType<UpsertDriverSavedPlaceRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof upsertDriverSavedPlace>>, TError, {
    data: BodyType<UpsertDriverSavedPlaceRequest>;
}, TContext>;
/**
 * @summary Delete a saved/recent place
 */
export declare const getDeleteDriverSavedPlaceUrl: (id: string) => string;
export declare const deleteDriverSavedPlace: (id: string, options?: RequestInit) => Promise<OkResponse>;
export declare const getDeleteDriverSavedPlaceMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteDriverSavedPlace>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteDriverSavedPlace>>, TError, {
    id: string;
}, TContext>;
export type DeleteDriverSavedPlaceMutationResult = NonNullable<Awaited<ReturnType<typeof deleteDriverSavedPlace>>>;
export type DeleteDriverSavedPlaceMutationError = ErrorType<unknown>;
/**
 * @summary Delete a saved/recent place
 */
export declare const useDeleteDriverSavedPlace: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteDriverSavedPlace>>, TError, {
        id: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteDriverSavedPlace>>, TError, {
    id: string;
}, TContext>;
/**
 * @summary Decline a queued ride candidate (60s cooldown)
 */
export declare const getPostDriverQueuedRequestsRideIdDeclineUrl: (rideId: string) => string;
export declare const postDriverQueuedRequestsRideIdDecline: (rideId: string, options?: RequestInit) => Promise<PostDriverQueuedRequestsRideIdDecline200>;
export declare const getPostDriverQueuedRequestsRideIdDeclineMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdDecline>>, TError, {
        rideId: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdDecline>>, TError, {
    rideId: string;
}, TContext>;
export type PostDriverQueuedRequestsRideIdDeclineMutationResult = NonNullable<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdDecline>>>;
export type PostDriverQueuedRequestsRideIdDeclineMutationError = ErrorType<unknown>;
/**
 * @summary Decline a queued ride candidate (60s cooldown)
 */
export declare const usePostDriverQueuedRequestsRideIdDecline: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdDecline>>, TError, {
        rideId: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof postDriverQueuedRequestsRideIdDecline>>, TError, {
    rideId: string;
}, TContext>;
/**
 * @summary List every currency in the catalog (USD first, then alphabetical).
 */
export declare const getListAdminCurrenciesUrl: () => string;
export declare const listAdminCurrencies: (options?: RequestInit) => Promise<AdminCurrencyListResponse>;
export declare const getListAdminCurrenciesQueryKey: () => readonly ["/api/admin/currencies"];
export declare const getListAdminCurrenciesQueryOptions: <TData = Awaited<ReturnType<typeof listAdminCurrencies>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAdminCurrencies>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listAdminCurrencies>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListAdminCurrenciesQueryResult = NonNullable<Awaited<ReturnType<typeof listAdminCurrencies>>>;
export type ListAdminCurrenciesQueryError = ErrorType<unknown>;
/**
 * @summary List every currency in the catalog (USD first, then alphabetical).
 */
export declare function useListAdminCurrencies<TData = Awaited<ReturnType<typeof listAdminCurrencies>>, TError = ErrorType<unknown>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listAdminCurrencies>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Add a new currency to the catalog.
 */
export declare const getCreateAdminCurrencyUrl: () => string;
export declare const createAdminCurrency: (createAdminCurrencyRequest: CreateAdminCurrencyRequest, options?: RequestInit) => Promise<AdminCurrencySingleResponse>;
export declare const getCreateAdminCurrencyMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdminCurrency>>, TError, {
        data: BodyType<CreateAdminCurrencyRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createAdminCurrency>>, TError, {
    data: BodyType<CreateAdminCurrencyRequest>;
}, TContext>;
export type CreateAdminCurrencyMutationResult = NonNullable<Awaited<ReturnType<typeof createAdminCurrency>>>;
export type CreateAdminCurrencyMutationBody = BodyType<CreateAdminCurrencyRequest>;
export type CreateAdminCurrencyMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Add a new currency to the catalog.
 */
export declare const useCreateAdminCurrency: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createAdminCurrency>>, TError, {
        data: BodyType<CreateAdminCurrencyRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createAdminCurrency>>, TError, {
    data: BodyType<CreateAdminCurrencyRequest>;
}, TContext>;
/**
 * @summary Manually trigger an exchange-rate refresh.
 */
export declare const getRefreshAdminCurrenciesUrl: () => string;
export declare const refreshAdminCurrencies: (options?: RequestInit) => Promise<AdminCurrencyRefreshResponse>;
export declare const getRefreshAdminCurrenciesMutationOptions: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof refreshAdminCurrencies>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof refreshAdminCurrencies>>, TError, void, TContext>;
export type RefreshAdminCurrenciesMutationResult = NonNullable<Awaited<ReturnType<typeof refreshAdminCurrencies>>>;
export type RefreshAdminCurrenciesMutationError = ErrorType<unknown>;
/**
 * @summary Manually trigger an exchange-rate refresh.
 */
export declare const useRefreshAdminCurrencies: <TError = ErrorType<unknown>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof refreshAdminCurrencies>>, TError, void, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof refreshAdminCurrencies>>, TError, void, TContext>;
/**
 * @summary Persist a new ordering for the currency selectors.
 */
export declare const getReorderAdminCurrenciesUrl: () => string;
export declare const reorderAdminCurrencies: (reorderAdminCurrenciesBody: ReorderAdminCurrenciesBody, options?: RequestInit) => Promise<AdminCurrencyListResponse>;
export declare const getReorderAdminCurrenciesMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reorderAdminCurrencies>>, TError, {
        data: BodyType<ReorderAdminCurrenciesBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof reorderAdminCurrencies>>, TError, {
    data: BodyType<ReorderAdminCurrenciesBody>;
}, TContext>;
export type ReorderAdminCurrenciesMutationResult = NonNullable<Awaited<ReturnType<typeof reorderAdminCurrencies>>>;
export type ReorderAdminCurrenciesMutationBody = BodyType<ReorderAdminCurrenciesBody>;
export type ReorderAdminCurrenciesMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Persist a new ordering for the currency selectors.
 */
export declare const useReorderAdminCurrencies: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof reorderAdminCurrencies>>, TError, {
        data: BodyType<ReorderAdminCurrenciesBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof reorderAdminCurrencies>>, TError, {
    data: BodyType<ReorderAdminCurrenciesBody>;
}, TContext>;
/**
 * @summary Fetch a single currency, including whether its code is locked for editing.
 */
export declare const getGetAdminCurrencyUrl: (code: string) => string;
export declare const getAdminCurrency: (code: string, options?: RequestInit) => Promise<AdminCurrencySingleResponse>;
export declare const getGetAdminCurrencyQueryKey: (code: string) => readonly [`/api/admin/currencies/${string}`];
export declare const getGetAdminCurrencyQueryOptions: <TData = Awaited<ReturnType<typeof getAdminCurrency>>, TError = ErrorType<ErrorEnvelope>>(code: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminCurrency>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getAdminCurrency>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetAdminCurrencyQueryResult = NonNullable<Awaited<ReturnType<typeof getAdminCurrency>>>;
export type GetAdminCurrencyQueryError = ErrorType<ErrorEnvelope>;
/**
 * @summary Fetch a single currency, including whether its code is locked for editing.
 */
export declare function useGetAdminCurrency<TData = Awaited<ReturnType<typeof getAdminCurrency>>, TError = ErrorType<ErrorEnvelope>>(code: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getAdminCurrency>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Update a currency (active flag, name, symbol, rate, formatting).
 */
export declare const getUpdateAdminCurrencyUrl: (code: string) => string;
export declare const updateAdminCurrency: (code: string, updateAdminCurrencyRequest: UpdateAdminCurrencyRequest, options?: RequestInit) => Promise<UpdateAdminCurrency200>;
export declare const getUpdateAdminCurrencyMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdminCurrency>>, TError, {
        code: string;
        data: BodyType<UpdateAdminCurrencyRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateAdminCurrency>>, TError, {
    code: string;
    data: BodyType<UpdateAdminCurrencyRequest>;
}, TContext>;
export type UpdateAdminCurrencyMutationResult = NonNullable<Awaited<ReturnType<typeof updateAdminCurrency>>>;
export type UpdateAdminCurrencyMutationBody = BodyType<UpdateAdminCurrencyRequest>;
export type UpdateAdminCurrencyMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Update a currency (active flag, name, symbol, rate, formatting).
 */
export declare const useUpdateAdminCurrency: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateAdminCurrency>>, TError, {
        code: string;
        data: BodyType<UpdateAdminCurrencyRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateAdminCurrency>>, TError, {
    code: string;
    data: BodyType<UpdateAdminCurrencyRequest>;
}, TContext>;
/**
 * @summary Delete a currency (refused when in use, USD, or current default).
 */
export declare const getDeleteAdminCurrencyUrl: (code: string) => string;
export declare const deleteAdminCurrency: (code: string, options?: RequestInit) => Promise<OkResponse>;
export declare const getDeleteAdminCurrencyMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAdminCurrency>>, TError, {
        code: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof deleteAdminCurrency>>, TError, {
    code: string;
}, TContext>;
export type DeleteAdminCurrencyMutationResult = NonNullable<Awaited<ReturnType<typeof deleteAdminCurrency>>>;
export type DeleteAdminCurrencyMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Delete a currency (refused when in use, USD, or current default).
 */
export declare const useDeleteAdminCurrency: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof deleteAdminCurrency>>, TError, {
        code: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof deleteAdminCurrency>>, TError, {
    code: string;
}, TContext>;
/**
 * @summary Mark this currency as the platform default (updates app_settings.displayCurrency).
 */
export declare const getSetAdminCurrencyDefaultUrl: (code: string) => string;
export declare const setAdminCurrencyDefault: (code: string, options?: RequestInit) => Promise<AdminCurrencySetDefaultResponse>;
export declare const getSetAdminCurrencyDefaultMutationOptions: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setAdminCurrencyDefault>>, TError, {
        code: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof setAdminCurrencyDefault>>, TError, {
    code: string;
}, TContext>;
export type SetAdminCurrencyDefaultMutationResult = NonNullable<Awaited<ReturnType<typeof setAdminCurrencyDefault>>>;
export type SetAdminCurrencyDefaultMutationError = ErrorType<ErrorEnvelope>;
/**
 * @summary Mark this currency as the platform default (updates app_settings.displayCurrency).
 */
export declare const useSetAdminCurrencyDefault: <TError = ErrorType<ErrorEnvelope>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof setAdminCurrencyDefault>>, TError, {
        code: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof setAdminCurrencyDefault>>, TError, {
    code: string;
}, TContext>;
/**
 * @summary List trip chat history (ephemeral — empty for inactive trips).
 */
export declare const getListTripMessagesUrl: (tripId: string) => string;
export declare const listTripMessages: (tripId: string, options?: RequestInit) => Promise<ListTripMessages200>;
export declare const getListTripMessagesQueryKey: (tripId: string) => readonly [`/api/trips/${string}/messages`];
export declare const getListTripMessagesQueryOptions: <TData = Awaited<ReturnType<typeof listTripMessages>>, TError = ErrorType<void>>(tripId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTripMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof listTripMessages>>, TError, TData> & {
    queryKey: QueryKey;
};
export type ListTripMessagesQueryResult = NonNullable<Awaited<ReturnType<typeof listTripMessages>>>;
export type ListTripMessagesQueryError = ErrorType<void>;
/**
 * @summary List trip chat history (ephemeral — empty for inactive trips).
 */
export declare function useListTripMessages<TData = Awaited<ReturnType<typeof listTripMessages>>, TError = ErrorType<void>>(tripId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof listTripMessages>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Rate-limited to 30 messages / minute / (user, trip). Returns 429 with
a `Retry-After` header when exceeded. Recipient receives a realtime
`trip:message` socket event and (when offline / not in chat) a push.

 * @summary Send a chat message in an active trip.
 */
export declare const getCreateTripMessageUrl: (tripId: string) => string;
export declare const createTripMessage: (tripId: string, createTripMessageRequest: CreateTripMessageRequest, options?: RequestInit) => Promise<CreateTripMessage200 | CreateTripMessage201>;
export declare const getCreateTripMessageMutationOptions: <TError = ErrorType<void | CreateTripMessage429>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createTripMessage>>, TError, {
        tripId: string;
        data: BodyType<CreateTripMessageRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createTripMessage>>, TError, {
    tripId: string;
    data: BodyType<CreateTripMessageRequest>;
}, TContext>;
export type CreateTripMessageMutationResult = NonNullable<Awaited<ReturnType<typeof createTripMessage>>>;
export type CreateTripMessageMutationBody = BodyType<CreateTripMessageRequest>;
export type CreateTripMessageMutationError = ErrorType<void | CreateTripMessage429>;
/**
 * @summary Send a chat message in an active trip.
 */
export declare const useCreateTripMessage: <TError = ErrorType<void | CreateTripMessage429>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createTripMessage>>, TError, {
        tripId: string;
        data: BodyType<CreateTripMessageRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createTripMessage>>, TError, {
    tripId: string;
    data: BodyType<CreateTripMessageRequest>;
}, TContext>;
/**
 * @summary Per-trip unread chat count for the caller.
 */
export declare const getGetTripUnreadCountUrl: (tripId: string) => string;
export declare const getTripUnreadCount: (tripId: string, options?: RequestInit) => Promise<GetTripUnreadCount200>;
export declare const getGetTripUnreadCountQueryKey: (tripId: string) => readonly [`/api/trips/${string}/unread-count`];
export declare const getGetTripUnreadCountQueryOptions: <TData = Awaited<ReturnType<typeof getTripUnreadCount>>, TError = ErrorType<void>>(tripId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTripUnreadCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getTripUnreadCount>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetTripUnreadCountQueryResult = NonNullable<Awaited<ReturnType<typeof getTripUnreadCount>>>;
export type GetTripUnreadCountQueryError = ErrorType<void>;
/**
 * @summary Per-trip unread chat count for the caller.
 */
export declare function useGetTripUnreadCount<TData = Awaited<ReturnType<typeof getTripUnreadCount>>, TError = ErrorType<void>>(tripId: string, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getTripUnreadCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Aggregate unread chat count across all active trips.
 */
export declare const getGetGlobalUnreadCountUrl: () => string;
export declare const getGlobalUnreadCount: (options?: RequestInit) => Promise<GetGlobalUnreadCount200>;
export declare const getGetGlobalUnreadCountQueryKey: () => readonly ["/api/chat/unread-count"];
export declare const getGetGlobalUnreadCountQueryOptions: <TData = Awaited<ReturnType<typeof getGlobalUnreadCount>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGlobalUnreadCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getGlobalUnreadCount>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetGlobalUnreadCountQueryResult = NonNullable<Awaited<ReturnType<typeof getGlobalUnreadCount>>>;
export type GetGlobalUnreadCountQueryError = ErrorType<void>;
/**
 * @summary Aggregate unread chat count across all active trips.
 */
export declare function useGetGlobalUnreadCount<TData = Awaited<ReturnType<typeof getGlobalUnreadCount>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getGlobalUnreadCount>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Marks every message sent by the peer up to and including
`upToMessageId` (or all if omitted) as read. Emits `chat:message:read`
to the sender (✓✓ blue) and `chat:unread:update` with the actual
remaining unread count for the caller.

 * @summary Mark peer messages in a trip as read (and delivered).
 */
export declare const getMarkTripMessagesReadUrl: (tripId: string) => string;
export declare const markTripMessagesRead: (tripId: string, markTripMessagesReadRequest?: MarkTripMessagesReadRequest, options?: RequestInit) => Promise<MarkTripMessagesRead200>;
export declare const getMarkTripMessagesReadMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markTripMessagesRead>>, TError, {
        tripId: string;
        data: BodyType<MarkTripMessagesReadRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof markTripMessagesRead>>, TError, {
    tripId: string;
    data: BodyType<MarkTripMessagesReadRequest>;
}, TContext>;
export type MarkTripMessagesReadMutationResult = NonNullable<Awaited<ReturnType<typeof markTripMessagesRead>>>;
export type MarkTripMessagesReadMutationBody = BodyType<MarkTripMessagesReadRequest>;
export type MarkTripMessagesReadMutationError = ErrorType<void>;
/**
 * @summary Mark peer messages in a trip as read (and delivered).
 */
export declare const useMarkTripMessagesRead: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof markTripMessagesRead>>, TError, {
        tripId: string;
        data: BodyType<MarkTripMessagesReadRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof markTripMessagesRead>>, TError, {
    tripId: string;
    data: BodyType<MarkTripMessagesReadRequest>;
}, TContext>;
/**
 * @summary Presigned upload URL for a chat image or voice attachment.
 */
export declare const getRequestChatUploadUrlUrl: () => string;
export declare const requestChatUploadUrl: (chatUploadRequest: ChatUploadRequest, options?: RequestInit) => Promise<ChatUploadResponse>;
export declare const getRequestChatUploadUrlMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestChatUploadUrl>>, TError, {
        data: BodyType<ChatUploadRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof requestChatUploadUrl>>, TError, {
    data: BodyType<ChatUploadRequest>;
}, TContext>;
export type RequestChatUploadUrlMutationResult = NonNullable<Awaited<ReturnType<typeof requestChatUploadUrl>>>;
export type RequestChatUploadUrlMutationBody = BodyType<ChatUploadRequest>;
export type RequestChatUploadUrlMutationError = ErrorType<void>;
/**
 * @summary Presigned upload URL for a chat image or voice attachment.
 */
export declare const useRequestChatUploadUrl: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof requestChatUploadUrl>>, TError, {
        data: BodyType<ChatUploadRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof requestChatUploadUrl>>, TError, {
    data: BodyType<ChatUploadRequest>;
}, TContext>;
/**
 * @summary Finalize a chat attachment upload (set ACL).
 */
export declare const getFinalizeChatUploadUrl: () => string;
export declare const finalizeChatUpload: (chatFinalizeRequest: ChatFinalizeRequest, options?: RequestInit) => Promise<FinalizeChatUpload200>;
export declare const getFinalizeChatUploadMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof finalizeChatUpload>>, TError, {
        data: BodyType<ChatFinalizeRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof finalizeChatUpload>>, TError, {
    data: BodyType<ChatFinalizeRequest>;
}, TContext>;
export type FinalizeChatUploadMutationResult = NonNullable<Awaited<ReturnType<typeof finalizeChatUpload>>>;
export type FinalizeChatUploadMutationBody = BodyType<ChatFinalizeRequest>;
export type FinalizeChatUploadMutationError = ErrorType<void>;
/**
 * @summary Finalize a chat attachment upload (set ACL).
 */
export declare const useFinalizeChatUpload: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof finalizeChatUpload>>, TError, {
        data: BodyType<ChatFinalizeRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof finalizeChatUpload>>, TError, {
    data: BodyType<ChatFinalizeRequest>;
}, TContext>;
/**
 * Returns the user's saved quick-reply phrases for both the rider and
driver chat sides. When the user has never edited a side the
corresponding array is empty and clients should fall back to the
built-in defaults.

 * @summary Get the signed-in user's customised chat quick-reply lists.
 */
export declare const getGetMyQuickRepliesUrl: () => string;
export declare const getMyQuickReplies: (options?: RequestInit) => Promise<QuickRepliesResponse>;
export declare const getGetMyQuickRepliesQueryKey: () => readonly ["/api/me/quick-replies"];
export declare const getGetMyQuickRepliesQueryOptions: <TData = Awaited<ReturnType<typeof getMyQuickReplies>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyQuickReplies>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getMyQuickReplies>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetMyQuickRepliesQueryResult = NonNullable<Awaited<ReturnType<typeof getMyQuickReplies>>>;
export type GetMyQuickRepliesQueryError = ErrorType<void>;
/**
 * @summary Get the signed-in user's customised chat quick-reply lists.
 */
export declare function useGetMyQuickReplies<TData = Awaited<ReturnType<typeof getMyQuickReplies>>, TError = ErrorType<void>>(options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getMyQuickReplies>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * Replaces the saved phrases for either the rider or driver chat side.
Entries are trimmed, blanks dropped, clipped to 60 characters, and
capped at 12 items. Returns the persisted lists.

 * @summary Replace the signed-in user's quick-reply list for one role.
 */
export declare const getUpdateMyQuickRepliesUrl: () => string;
export declare const updateMyQuickReplies: (updateQuickRepliesRequest: UpdateQuickRepliesRequest, options?: RequestInit) => Promise<QuickRepliesResponse>;
export declare const getUpdateMyQuickRepliesMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMyQuickReplies>>, TError, {
        data: BodyType<UpdateQuickRepliesRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof updateMyQuickReplies>>, TError, {
    data: BodyType<UpdateQuickRepliesRequest>;
}, TContext>;
export type UpdateMyQuickRepliesMutationResult = NonNullable<Awaited<ReturnType<typeof updateMyQuickReplies>>>;
export type UpdateMyQuickRepliesMutationBody = BodyType<UpdateQuickRepliesRequest>;
export type UpdateMyQuickRepliesMutationError = ErrorType<void>;
/**
 * @summary Replace the signed-in user's quick-reply list for one role.
 */
export declare const useUpdateMyQuickReplies: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof updateMyQuickReplies>>, TError, {
        data: BodyType<UpdateQuickRepliesRequest>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof updateMyQuickReplies>>, TError, {
    data: BodyType<UpdateQuickRepliesRequest>;
}, TContext>;
/**
 * @summary List active bidding rides within driver's radius.
 */
export declare const getGetBiddingNearbyUrl: (params?: GetBiddingNearbyParams) => string;
export declare const getBiddingNearby: (params?: GetBiddingNearbyParams, options?: RequestInit) => Promise<BiddingNearbyResponse>;
export declare const getGetBiddingNearbyQueryKey: (params?: GetBiddingNearbyParams) => readonly ["/api/bidding/nearby", ...GetBiddingNearbyParams[]];
export declare const getGetBiddingNearbyQueryOptions: <TData = Awaited<ReturnType<typeof getBiddingNearby>>, TError = ErrorType<void>>(params?: GetBiddingNearbyParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBiddingNearby>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}) => UseQueryOptions<Awaited<ReturnType<typeof getBiddingNearby>>, TError, TData> & {
    queryKey: QueryKey;
};
export type GetBiddingNearbyQueryResult = NonNullable<Awaited<ReturnType<typeof getBiddingNearby>>>;
export type GetBiddingNearbyQueryError = ErrorType<void>;
/**
 * @summary List active bidding rides within driver's radius.
 */
export declare function useGetBiddingNearby<TData = Awaited<ReturnType<typeof getBiddingNearby>>, TError = ErrorType<void>>(params?: GetBiddingNearbyParams, options?: {
    query?: UseQueryOptions<Awaited<ReturnType<typeof getBiddingNearby>>, TError, TData>;
    request?: SecondParameter<typeof customFetch>;
}): UseQueryResult<TData, TError> & {
    queryKey: QueryKey;
};
/**
 * @summary Driver posts (or counter-offers) a bid on a bidding ride.
 */
export declare const getCreateBiddingOfferUrl: () => string;
export declare const createBiddingOffer: (createBiddingOfferBody: CreateBiddingOfferBody, options?: RequestInit) => Promise<BiddingOfferResponse>;
export declare const getCreateBiddingOfferMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBiddingOffer>>, TError, {
        data: BodyType<CreateBiddingOfferBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof createBiddingOffer>>, TError, {
    data: BodyType<CreateBiddingOfferBody>;
}, TContext>;
export type CreateBiddingOfferMutationResult = NonNullable<Awaited<ReturnType<typeof createBiddingOffer>>>;
export type CreateBiddingOfferMutationBody = BodyType<CreateBiddingOfferBody>;
export type CreateBiddingOfferMutationError = ErrorType<void>;
/**
 * @summary Driver posts (or counter-offers) a bid on a bidding ride.
 */
export declare const useCreateBiddingOffer: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof createBiddingOffer>>, TError, {
        data: BodyType<CreateBiddingOfferBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof createBiddingOffer>>, TError, {
    data: BodyType<CreateBiddingOfferBody>;
}, TContext>;
/**
 * @summary Driver withdraws an active bid.
 */
export declare const getWithdrawBiddingOfferUrl: (bidId: string) => string;
export declare const withdrawBiddingOffer: (bidId: string, options?: RequestInit) => Promise<BiddingOfferResponse>;
export declare const getWithdrawBiddingOfferMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof withdrawBiddingOffer>>, TError, {
        bidId: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof withdrawBiddingOffer>>, TError, {
    bidId: string;
}, TContext>;
export type WithdrawBiddingOfferMutationResult = NonNullable<Awaited<ReturnType<typeof withdrawBiddingOffer>>>;
export type WithdrawBiddingOfferMutationError = ErrorType<void>;
/**
 * @summary Driver withdraws an active bid.
 */
export declare const useWithdrawBiddingOffer: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof withdrawBiddingOffer>>, TError, {
        bidId: string;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof withdrawBiddingOffer>>, TError, {
    bidId: string;
}, TContext>;
/**
 * @summary Rider accepts one driver's offer; other active bids are rejected.
 */
export declare const getAcceptBiddingOfferUrl: (rideId: string) => string;
export declare const acceptBiddingOffer: (rideId: string, acceptBiddingOfferBody: AcceptBiddingOfferBody, options?: RequestInit) => Promise<AcceptBiddingOfferResponse>;
export declare const getAcceptBiddingOfferMutationOptions: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof acceptBiddingOffer>>, TError, {
        rideId: string;
        data: BodyType<AcceptBiddingOfferBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationOptions<Awaited<ReturnType<typeof acceptBiddingOffer>>, TError, {
    rideId: string;
    data: BodyType<AcceptBiddingOfferBody>;
}, TContext>;
export type AcceptBiddingOfferMutationResult = NonNullable<Awaited<ReturnType<typeof acceptBiddingOffer>>>;
export type AcceptBiddingOfferMutationBody = BodyType<AcceptBiddingOfferBody>;
export type AcceptBiddingOfferMutationError = ErrorType<void>;
/**
 * @summary Rider accepts one driver's offer; other active bids are rejected.
 */
export declare const useAcceptBiddingOffer: <TError = ErrorType<void>, TContext = unknown>(options?: {
    mutation?: UseMutationOptions<Awaited<ReturnType<typeof acceptBiddingOffer>>, TError, {
        rideId: string;
        data: BodyType<AcceptBiddingOfferBody>;
    }, TContext>;
    request?: SecondParameter<typeof customFetch>;
}) => UseMutationResult<Awaited<ReturnType<typeof acceptBiddingOffer>>, TError, {
    rideId: string;
    data: BodyType<AcceptBiddingOfferBody>;
}, TContext>;
export {};
//# sourceMappingURL=api.d.ts.map