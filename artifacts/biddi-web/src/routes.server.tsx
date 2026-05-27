import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useSite } from "@/lib/site-context";
import { PageShell } from "@/components/PageShell";
import { HomePage } from "@/pages/HomePage";
import { LANGS } from "@/lib/i18n";
// Eager imports — required for SSR. `renderToString` is synchronous and
// cannot resolve `React.lazy` Suspense boundaries, so the server build
// uses these direct imports to render fully-formed HTML in one pass.
import { ContactPage } from "@/pages/ContactPage";
import { SitePage } from "@/pages/SitePage";
import { SignInPage, SignUpPage, ForgotPasswordPage } from "@/pages/AuthPages";
import { NotFoundPage, MaintenancePage } from "@/pages/StatusPages";

function RootRedirect() {
  const { lang } = useSite();
  const [, setLocation] = useLocation();
  useEffect(() => { setLocation(`/${lang}/`, { replace: true }); }, [lang, setLocation]);
  return null;
}

export function Routes() {
  const { settings } = useSite();
  if (settings?.maintenanceMode) {
    return (
      <PageShell>
        <MaintenancePage message={settings.maintenanceMessage} />
      </PageShell>
    );
  }
  return (
    <PageShell>
      <Switch>
        <Route path="/" component={RootRedirect} />
        {LANGS.flatMap((lang) => [
          <Route key={`${lang}-home`} path={`/${lang}`} component={HomePage} />,
          <Route key={`${lang}-home2`} path={`/${lang}/`} component={HomePage} />,
          <Route key={`${lang}-contact`} path={`/${lang}/contact`} component={ContactPage} />,
          <Route key={`${lang}-signin`} path={`/${lang}/signin`} component={SignInPage} />,
          <Route key={`${lang}-signup`} path={`/${lang}/signup`} component={SignUpPage} />,
          <Route key={`${lang}-forgot`} path={`/${lang}/forgot-password`} component={ForgotPasswordPage} />,
          <Route key={`${lang}-maintenance`} path={`/${lang}/maintenance`}>
            <MaintenancePage />
          </Route>,
          <Route key={`${lang}-cms`} path={`/${lang}/:slug`}>
            {(params) => <SitePage slug={params.slug} />}
          </Route>,
        ])}
        <Route component={NotFoundPage} />
      </Switch>
    </PageShell>
  );
}
