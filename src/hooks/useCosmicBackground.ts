import { useEffect, useState } from "react";

const KEY = "nyx.cosmicBackground";
const EVENT = "nyx:cosmicBackground";

export function getCosmicBackground(): boolean {
  if (typeof window === "undefined") return false;
  return window.localStorage.getItem(KEY) === "1";
}

export function setCosmicBackground(on: boolean) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, on ? "1" : "0");
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function useCosmicBackground(): [boolean, (v: boolean) => void] {
  const [on, setOn] = useState(false);
  useEffect(() => {
    setOn(getCosmicBackground());
    const handler = (e: Event) => setOn((e as CustomEvent<boolean>).detail);
    window.addEventListener(EVENT, handler);
    return () => window.removeEventListener(EVENT, handler);
  }, []);
  return [
    on,
    (v: boolean) => {
      setCosmicBackground(v);
      setOn(v);
    },
  ];
}
