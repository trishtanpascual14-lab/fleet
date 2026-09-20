import { useEffect, useState } from 'react';

const timeFormatter = new Intl.DateTimeFormat('en-US', {
  hour: 'numeric',
  minute: '2-digit',
  hour12: true,
});

const dateFormatter = new Intl.DateTimeFormat('en-US', {
  month: 'long',
  day: 'numeric',
  year: 'numeric',
});

export default function LiveClock() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div
      className="hidden sm:block text-right leading-tight px-1 select-none"
      title="Local time"
    >
      <p className="text-sm font-extrabold text-slate-900 tabular-nums leading-tight">
        {timeFormatter.format(now)}
      </p>
      <p className="text-[11px] text-slate-500 font-medium leading-tight">
        {dateFormatter.format(now)}
      </p>
    </div>
  );
}
