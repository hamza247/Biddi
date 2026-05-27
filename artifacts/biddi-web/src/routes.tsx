import { useEffect } from "react";
import { Switch, Route, useLocation } from "wouter";
import { useSite } from "@/lib/site-context";
import { PageShell } from "@/components/PageShell";
import { HomePage } from "@/pages/HomePage";
import { LANGS } from "@/lib/i18n";
// Eager imports on the client too. We previously used `React.lazy` here,
// but lazy boundaries during `hydrateRoot` briefly render `Suspense`
// fallbacks before the chunk loads, which doesn't match the SSR HTML
// (which is rendered eagerly via `routes.server.tsx`) and causes
// hydration warnings / a flash of fallback content. Importing eagerly
// keeps the client and server route trees structurally identical.
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
