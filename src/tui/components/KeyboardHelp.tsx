import { Box, Text } from 'ink';
import chalk from 'chalk';

interface Shortcut {
  key: string;
  label: string;
}

interface Props {
  shortcuts: Shortcut[];
}

export default function KeyboardHelp({ shortcuts }: Props) {
  return (
    <Box flexDirection="row" flexWrap="wrap" gap={2}>
      {shortcuts.map((shortcut) => (
        <Box key={shortcut.key} flexDirection="row" gap={1}>
          <Text>{chalk.bold.inverse(` ${shortcut.key} `)}</Text>
          <Text>{chalk.dim(shortcut.label)}</Text>
        </Box>
      ))}
    </Box>
  );
}
