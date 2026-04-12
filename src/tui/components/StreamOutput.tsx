import { Box, Text } from 'ink';
import Spinner from 'ink-spinner';
import chalk from 'chalk';

interface Props {
  content: string;
  maxHeight?: number;
  streaming?: boolean;
}

export default function StreamOutput({ content, maxHeight, streaming = false }: Props) {
  const lines = content.split('\n');
  const visibleLines =
    maxHeight !== undefined && lines.length > maxHeight
      ? lines.slice(lines.length - maxHeight)
      : lines;

  return (
    <Box flexDirection="column">
      <Box flexDirection="column">
        {visibleLines.map((line, i) => (
          <Text key={i}>{line}</Text>
        ))}
      </Box>
      {streaming && (
        <Box flexDirection="row" gap={1}>
          <Spinner type="dots" />
          <Text>{chalk.dim('streaming...')}</Text>
        </Box>
      )}
    </Box>
  );
}
