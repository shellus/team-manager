import { useEffect, useRef, useState } from "react";
import { Alert, Skeleton } from "antd";
import type { eventWithTime } from "rrweb";
import "rrweb-player/dist/style.css";

interface PlayerHandle {
  pause?: () => void;
  $destroy?: () => void;
}

export function RrwebReplay({ recording }: { recording: unknown }) {
  const target = useRef<HTMLDivElement>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setError("");
    if (!target.current) return;
    let active = true;
    let player: PlayerHandle | undefined;
    const events = Array.isArray(recording)
      ? recording
      : (recording as { events?: unknown[] } | undefined)?.events;
    if (!Array.isArray(events) || events.length < 2) {
      setError("录制文件缺少有效 rrweb 事件");
      return;
    }

    void import("rrweb-player")
      .then(({ default: RrwebPlayer }) => {
        if (!active || !target.current) return;
        target.current.replaceChildren();
        const width = Math.max(
          320,
          Math.min(1_050, target.current.clientWidth || innerWidth - 120),
        );
        player = new RrwebPlayer({
          target: target.current,
          props: {
            events: events as eventWithTime[],
            width,
            height: Math.round(width * 0.6),
            autoPlay: false,
            showController: true,
            skipInactive: true,
          },
        });
      })
      .catch((reason) => setError((reason as Error).message));

    return () => {
      active = false;
      player?.pause?.();
      player?.$destroy?.();
      target.current?.replaceChildren();
    };
  }, [recording]);

  if (error) return <Alert type="error" showIcon message={error} />;
  return (
    <div ref={target} className="rrweb-replay-host">
      <Skeleton active />
    </div>
  );
}
