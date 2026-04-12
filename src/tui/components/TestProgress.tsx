import { Box, Text } from 'ink';
import chalk from 'chalk';

type TestStatus = 'pending' | 'writing' | 'passing' | 'failing';

interface TestItem {
  name: string;
  status: TestStatus;
}

interface Props {
  tests: TestItem[];
}

const STATUS_ICONS: Record<TestStatus, string> = {
  pending: '○',
  writing: '◐',
  passing: '✓',
  failing: '✗',
};

const STATUS_COLORS: Record<TestStatus, (s: string) => string> = {
  pending: chalk.dim,
  writing: chalk.yellow,
  passing: chalk.green,
  failing: chalk.red,
};

export default function TestProgress({ tests }: Props) {
  const passing = tests.filter((t) => t.status === 'passing').length;
  const failing = tests.filter((t) => t.status === 'failing').length;
  const pending = tests.filter((t) => t.status === 'pending').length;
  const writing = tests.filter((t) => t.status === 'writing').length;

  return (
    <Box flexDirection="column">
      {tests.map((test) => {
        const color = STATUS_COLORS[test.status];
        const icon = STATUS_ICONS[test.status];
        return (
          <Box key={test.name} flexDirection="row" gap={1}>
            <Text>{color(icon)}</Text>
            <Text>{color(test.name)}</Text>
          </Box>
        );
      })}
      {tests.length > 0 && (
        <Box marginTop={1}>
          <Text>
            {chalk.green(`${passing} passing`)}{' '}
            {failing > 0 ? chalk.red(`${failing} failing`) + ' ' : ''}
            {writing > 0 ? chalk.yellow(`${writing} writing`) + ' ' : ''}
            {pending > 0 ? chalk.dim(`${pending} pending`) : ''}
          </Text>
        </Box>
      )}
    </Box>
  );
}
