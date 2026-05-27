import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/lib/auth-context";
import { Layout } from "@/components/Layout";
import LoginPage from "@/pages/login";
import DashboardPage from "@/pages/dashboard";
import DriversPage from "@/pages/drivers";
import UsersPage from "@/pages/users";
import RiderActionPage from "@/pages/rider_action";
import RidesPage from "@/pages/rides";
import SettingsPage from "@/pages/settings";
import BidsPage from "@/pages/bids";
import BiddingPostsPage from "@/pages/bidding-posts";
import BiddingPostDetailPage from "@/pages/bidding-post-detail";
import TripsPage from "@/pages/trips";
import PaymentsPage from "@/pages/payments";
import FinanceReconciliationPage from "@/pages/finance-reconciliation";
import WithdrawalsPage from "@/pages/withdrawals";
import ReviewsPage from "@/pages/reviews";
import ReportsPage from "@/pages/reports";
import VehiclesPage from "@/pages/vehicles";
import VehicleTypesPage from "@/pages/vehicle-types";
import GeoFenceAllLocationsPage, { GeoFenceLocationsPage } from "@/pages/geo-fence-locations";
import RestrictedAreasPage from "@/pages/restricted-areas";
import GeoFenceEditPage from "@/pages/geo-fence-edit";
import GeoFenceCountriesPage from "@/pages/geo-fence-countries";
import WeatherSurchargePage from "@/pages/weather-surcharge";
import AirportSurchargesPage from "@/pages/airport-surcharges";
import DriverApplicationsPage from "@/pages/driver-applications";
import LiveMapPage from "@/pages/live-map";
import HeatViewPage from "@/pages/heat-view";
import RewardSettingsPage from "@/pages/reward-settings";
import ReferralSettingsPage from "@/pages/referral-settings";
import ReferralEarningsPage from "@/pages/referral-earnings";
import MlmReportPage from "@/pages/mlm-report";
import AppContentPage from "@/pages/app-content";
import NotificationsPage from "@/pages/notifications";
import AppClassesPage from "@/pages/app-classes";
import CouponsPage from "@/pages/coupons";
import DriverPromotionsPage from "@/pages/driverPromotions";
import SafetyAlertsPage from "@/pages/safety-alerts";
import WebsitePagesPage from "@/pages/website-pages";
import WebsitePageEditor from "@/pages/website-page-editor";
import WebsiteSettingsPage from "@/pages/website-settings";
import WebsiteSubmissionsPage from "@/pages/website-submissions";
import NotFound from "@/pages/not-found";

const queryClient = new QueryClient({
  defaultOptions: { queries: { refetchOnWindowFocus: false, retry: 1 } },
});

function Routes() {
  const { admin, ready } = useAuth();
  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center text-muted-foreground">
        Loading…
      </div>
    );
  }
  if (!admin) return <LoginPage />;
  return (
    <Layout>
      <Switch>
        <Route path="/" component={DashboardPage} />
        <Route path="/drivers" component={DriversPage} />
        <Route path="/users" component={UsersPage} />
        <Route path="/users/:userId/edit" component={RiderActionPage} />
        <Route path="/driver-applications" component={DriverApplicationsPage} />
        <Route path="/vehicles" component={VehiclesPage} />
        <Route path="/vehicle-types" component={VehicleTypesPage} />
        <Route path="/rides" component={RidesPage} />
        <Route path="/bids" component={BidsPage} />
        <Route path="/bidding/posts" component={BiddingPostsPage} />
        <Route path="/bidding/posts/:rideId" component={BiddingPostDetailPage} />
        <Route path="/trips" component={TripsPage} />
        <Route path="/payments" component={PaymentsPage} />
        <Route path="/finance/reconciliation" component={FinanceReconciliationPage} />
        <Route path="/withdrawals" component={WithdrawalsPage} />
        <Route path="/reviews" component={ReviewsPage} />
        <Route path="/live-map" component={LiveMapPage} />
        <Route path="/heat-view" component={HeatViewPage} />
        <Route path="/reports" component={ReportsPage} />
        <Route path="/service-areas" component={GeoFenceAllLocationsPage} />
        <Route path="/geo-fence/locations" component={GeoFenceAllLocationsPage} />
        <Route path="/geo-fence/locations/new" component={GeoFenceEditPage} />
        <Route path="/geo-fence/locations/:id/edit" component={GeoFenceEditPage} />
        <Route path="/geo-fence/restricted-areas" component={RestrictedAreasPage} />
        <Route path="/geo-fence/location-wise-fare">
          <GeoFenceLocationsPage
            fixedType="location_wise_fare"
            heading="Location Wise Fare"
            subheading="Zones with location-specific fare rules."
          />
        </Route>
        <Route path="/geo-fence/airport-surcharges" component={AirportSurchargesPage} />
        <Route path="/geo-fence/weather-surcharge" component={WeatherSurchargePage} />
        <Route path="/geo-fence/countries" component={GeoFenceCountriesPage} />
        <Route path="/reward-settings" component={RewardSettingsPage} />
        <Route path="/referral-settings" component={ReferralSettingsPage} />
        <Route path="/referral-earnings" component={ReferralEarningsPage} />
        <Route path="/mlm-report" component={MlmReportPage} />
        <Route path="/app-content" component={AppContentPage} />
        <Route path="/notifications" component={NotificationsPage} />
        <Route path="/app-classes" component={AppClassesPage} />
        <Route path="/coupons" component={CouponsPage} />
        <Route path="/driver-promotions" component={DriverPromotionsPage} />
        <Route path="/settings" component={SettingsPage} />
        <Route path="/safety-alerts" component={SafetyAlertsPage} />
        <Route path="/website/pages" component={WebsitePagesPage} />
        <Route path="/website/pages/:slug/:lang" component={WebsitePageEditor} />
        <Route path="/website/settings" component={WebsiteSettingsPage} />
        <Route path="/website/submissions" component={WebsiteSubmissionsPage} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <AuthProvider>
          <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
            <Routes />
          </WouterRouter>
          <Toaster />
        </AuthProvider>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
