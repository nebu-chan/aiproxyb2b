import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { DailyStat } from '../../api/analytics';

interface Props {
  data: DailyStat[];
  metric: 'requests' | 'tokens';
}

export function UsageChart({ data, metric }: Props) {
  const formatted = data.map((d) => ({
    ...d,
    label: format(parseISO(d.date), 'MMM d'),
  }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={formatted} margin={{ top: 5, right: 10, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="colorMain" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
          </linearGradient>
          <linearGradient id="colorErrors" x1="0" y1="0" x2="0" y2="1">
            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
        <XAxis dataKey="label" tick={{ fontSize: 12 }} />
        <YAxis tick={{ fontSize: 12 }} width={60} />
        <Tooltip
          formatter={(value: number) =>
            metric === 'tokens' ? value.toLocaleString() + ' tokens' : value.toLocaleString()
          }
        />
        <Legend />
        <Area
          type="monotone"
          dataKey={metric}
          name={metric === 'requests' ? 'Requests' : 'Tokens'}
          stroke="#3b82f6"
          fill="url(#colorMain)"
          strokeWidth={2}
        />
        {metric === 'requests' && (
          <Area
            type="monotone"
            dataKey="errors"
            name="Errors"
            stroke="#ef4444"
            fill="url(#colorErrors)"
            strokeWidth={2}
          />
        )}
      </AreaChart>
    </ResponsiveContainer>
  );
}
