import { Text } from 'ink';
import chalk from 'chalk';

type Status = 'waiting' | 'active' | 'complete' | 'failed';

interface Props {
  status: Status;
}

const ICONS: Record<Status, string> = {
  waiting: '○',
  active: '●',
  complete: '✓',
  failed: '✗',
};

const COLORS: Record<Status, (s: string) => string> = {
  waiting: chalk.dim,
  active: chalk.cyan,
  complete: chalk.green,
  failed: chalk.red,
};

export default function StatusBadge({ status }: Props) {
  const icon = ICONS[status];
  const color = COLORS[status];
  return <Text>{color(icon)}</Text>;
}
