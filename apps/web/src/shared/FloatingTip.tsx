import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';

export interface FloatingTipProps {
  /** tooltip content, rendered into document.body while shown */
  content: ReactNode;
  /** tip element class ('term-tip' | 'ds-tip') */
  className: string;
  /** preferred side of the anchor; flips when it would leave the viewport */
  placement?: 'top' | 'bottom';
  /** allow the pointer to move into the tip (e.g. to scroll long content) */
  interactive?: boolean;
  children: ReactNode;
}

const GAP = 8;
const EDGE = 8;
/** how long the pointer may travel between anchor and an interactive tip */
const CLOSE_DELAY_MS = 200;

interface Offset {
  left: number;
  top: number;
}

/**
 * Hover/focus tooltip rendered through a portal with `position: fixed` so it
 * is never clipped by ancestor scroll containers (the layout columns use
 * `overflow-y: auto`, which would cut off absolutely positioned tips).
 * Positions itself against the anchor's bounding box, flipped and clamped to
 * stay in the viewport, and follows scroll/resize while shown.
 */
export function FloatingTip({
  content,
  className,
  placement = 'top',
  interactive = false,
  children,
}: FloatingTipProps): ReactNode {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const tipRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef(0);
  const [open, setOpen] = useState(false);
  const [offset, setOffset] = useState<Offset | null>(null);

  const clearCloseTimer = (): void => {
    window.clearTimeout(closeTimer.current);
  };

  const show = (): void => {
    clearCloseTimer();
    setOpen(true);
  };

  const hide = useCallback((): void => {
    clearCloseTimer();
    closeTimer.current = window.setTimeout(() => setOpen(false), interactive ? CLOSE_DELAY_MS : 0);
  }, [interactive]);

  useEffect(() => clearCloseTimer, []);

  const place = useCallback((): void => {
    const anchor = anchorRef.current;
    const tip = tipRef.current;
    if (!anchor || !tip) return;
    const a = anchor.getBoundingClientRect();
    const t = tip.getBoundingClientRect();
    // horizontal: keep the tip's left edge at the anchor's, clamped to the viewport
    const left = Math.min(
      Math.max(EDGE, a.left),
      Math.max(EDGE, window.innerWidth - t.width - EDGE),
    );
    // vertical: preferred side first, flip to the other side when it overflows
    const above = a.top - t.height - GAP;
    const below = a.bottom + GAP;
    let top = placement === 'top' ? above : below;
    if (placement === 'top' && top < EDGE) top = below;
    if (placement === 'bottom' && top > window.innerHeight - t.height - EDGE) top = above;
    top = Math.min(Math.max(EDGE, top), Math.max(EDGE, window.innerHeight - t.height - EDGE));
    setOffset({ left, top });
  }, [placement]);

  useLayoutEffect(() => {
    if (!open) return;
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => {
      window.removeEventListener('resize', place);
      window.removeEventListener('scroll', place, true);
    };
  }, [open, place]);

  const tipStyle: CSSProperties = offset
    ? { left: offset.left, top: offset.top, visibility: 'visible' }
    : { visibility: 'hidden' };

  return (
    <span
      ref={anchorRef}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          clearCloseTimer();
          setOpen(false);
        }
      }}
    >
      {children}
      {open &&
        content != null &&
        createPortal(
          <div
            ref={tipRef}
            className={className}
            role="tooltip"
            style={tipStyle}
            onMouseEnter={interactive ? show : undefined}
            onMouseLeave={interactive ? hide : undefined}
          >
            {content}
          </div>,
          document.body,
        )}
    </span>
  );
}
