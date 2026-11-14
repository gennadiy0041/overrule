import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./styles.css";

function App() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center px-6">
      <p className="text-sm tracking-wide text-ink/60">For professionals who use AI at work</p>
      <h1 className="mt-3 font-serif text-5xl leading-[1.05]">AI does the work. You get paid for the judgment.</h1>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
