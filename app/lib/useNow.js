"use client";
import { useEffect, useState } from "react";
// current time that refreshes on its own, so "2h 10m in transit" stays live
export function useNow(ms = 30000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), ms); return () => clearInterval(t); }, [ms]);
  return now;
}
