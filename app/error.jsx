"use client";

export default function GlobalError({ error, reset }) {
  return (
    <html lang="en">
      <body>
        <main className="loginwrap">
          <section className="logincard">
            <div className="logo">🐝</div>
            <h1>3D Bee couldn't load</h1>
            <p className="alert" role="alert">{error?.message || "An unexpected browser error occurred."}</p>
            <p>Try reloading the dashboard. If this continues, check the Netlify deploy log and browser console.</p>
            <button className="btn primary block" onClick={() => reset()}>Try again</button>
          </section>
        </main>
      </body>
    </html>
  );
}
