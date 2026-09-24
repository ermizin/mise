"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { BorderBeam } from "border-beam";
import { Liquid } from "liquid-gooey";

const quietMotionQuery = "(prefers-reduced-motion: reduce), (forced-colors: active)";

function subscribeMotion(listener: () => void) {
  const media = window.matchMedia(quietMotionQuery);
  media.addEventListener("change", listener);
  document.addEventListener("visibilitychange", listener);
  return () => {
    media.removeEventListener("change", listener);
    document.removeEventListener("visibilitychange", listener);
  };
}

function motionAvailable() {
  return !window.matchMedia(quietMotionQuery).matches && !document.hidden;
}

function noServerMotion() {
  return false;
}

function useMotionAvailable() {
  return useSyncExternalStore(subscribeMotion, motionAvailable, noServerMotion);
}

/** The existing tab buttons retain all input, focus and selected-state semantics. */
export function LiquidNavIndicator({ enabled = true }: { enabled?: boolean }) {
  const animate = useMotionAvailable();
  if (!animate || !enabled) {
    return <span className="bottom-nav-indicator" aria-hidden="true" />;
  }
  return (
    <Liquid
      className="liquid-nav-layer"
      fill="#f2571a"
      blur={6}
      contrast={18}
      aria-hidden="true"
      style={{ position: "absolute", inset: 0, pointerEvents: "none" }}
    >
      <Liquid.Item effect="move" move={{ stretch: 0.6, trail: 0.35 }}>
        <span className="bottom-nav-indicator" />
      </Liquid.Item>
    </Liquid>
  );
}

/** Only mounted for the empty-plan CTA; the visible label remains the cue. */
export function ComposePlanGlow({ children }: { children: ReactNode }) {
  const animate = useMotionAvailable();
  return (
    <div className="compose-plan-glow">
      <BorderBeam
        size="pulse-inner"
        colorVariant="sunset"
        theme="light"
        strength={0.35}
        active={animate}
      >
        {children}
      </BorderBeam>
    </div>
  );
}
