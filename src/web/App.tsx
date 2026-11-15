import { lazy, Suspense, useEffect, type ReactNode } from "react";
import { BrowserRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import type { DailyStatus } from "../shared/api";
import { api } from "./lib/api";
import Landing from "./pages/Landing";
import { ButtonLink, PageLoading, Shell } from "./ui";

// The landing page ships in the entry chunk for a fast first paint; everything
// behind the first tap is split out.
const Scan = lazy(() => import("./pages/Scan"));
const ExposureMap = lazy(() => import("./pages/ExposureMap"));
const StartDrill = lazy(() => import("./pages/StartDrill"));
const Drill = lazy(() => import("./pages/Drill"));
const Result = lazy(() => import("./pages/Result"));
const Paywall = lazy(() => import("./pages/Paywall"));
const Checkout = lazy(() => import("./pages/Checkout"));
const Dashboard = lazy(() => import("./pages/Dashboard"));
const About = lazy(() => import("./pages/About"));
const Survey = lazy(() => import("./pages/Survey"));
const Defend = lazy(() => import("./pages/Defend"));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

/** `/daily` — resolve today's Daily Catch for this session and go there. */
function DailyRedirect() {
  const navigate = useNavigate();
  useEffect(() => {
    api
      .get<DailyStatus>("/api/daily")
      .then((daily) => {
        if (daily.state === "needs_scan") navigate("/scan", { replace: true });
        else if (daily.state === "done" && daily.attemptId) navigate(`/result/${daily.attemptId}`, { replace: true });
        else if (daily.drillId) navigate(`/drill/${daily.drillId}`, { replace: true });
        // No pre-built drill for this occupation yet: today’s is generated on first request.
        else navigate("/start?mode=daily", { replace: true });
      })
      .catch(() => navigate("/dashboard", { replace: true }));
  }, [navigate]);
  return <PageLoading label="Opening today’s Daily Catch…" />;
}

/** `/demo` — switch this browser to a fresh copy of the seeded demo profile. */
function DemoEntry() {
  const navigate = useNavigate();
  useEffect(() => {
    api
      .post("/api/demo")
      .then(() => navigate("/dashboard", { replace: true }))
      .catch(() => navigate("/", { replace: true }));
  }, [navigate]);
  return <PageLoading label="Loading the demo profile…" />;
}

function NotFound() {
  return (
    <Shell>
      <div className="flex min-h-[50dvh] flex-col items-center justify-center gap-4 text-center">
        <p className="eyebrow">404</p>
        <h1 className="text-3xl">Nothing to overrule here.</h1>
        <ButtonLink to="/" variant="dark">
          Back to the start
        </ButtonLink>
      </div>
    </Shell>
  );
}

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageLoading />}>{children}</Suspense>;
}

export function App() {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Lazy>
        <Routes>
          <Route path="/" element={<Landing />} />
          <Route path="/scan" element={<Scan />} />
          <Route path="/map" element={<ExposureMap />} />
          <Route path="/start" element={<StartDrill />} />
          <Route path="/drill/:drillId" element={<Drill />} />
          <Route path="/result/:attemptId" element={<Result />} />
          <Route path="/pro" element={<Paywall />} />
          <Route path="/checkout" element={<Checkout />} />
          <Route path="/dashboard" element={<Dashboard />} />
          <Route path="/daily" element={<DailyRedirect />} />
          <Route path="/demo" element={<DemoEntry />} />
          <Route path="/about" element={<About />} />
          <Route path="/survey" element={<Survey />} />
          <Route path="/defend" element={<Defend />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </Lazy>
    </BrowserRouter>
  );
}
