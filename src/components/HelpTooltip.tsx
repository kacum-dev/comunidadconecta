"use client";

import { useId } from "react";
import { Icon } from "./Icon";

export function HelpTooltip({
  label,
  children,
  align = "center"
}: {
  label: string;
  children: string;
  align?: "left" | "center" | "right";
}) {
  const id = useId();

  return (
    <span className={`help-tooltip align-${align}`}>
      <button
        type="button"
        className="help-tooltip-trigger"
        aria-label={`Ayuda sobre ${label}`}
        aria-describedby={id}
      >
        <Icon name="help" size={15} />
      </button>
      <span className="help-tooltip-content" id={id} role="tooltip">
        {children}
      </span>
    </span>
  );
}
