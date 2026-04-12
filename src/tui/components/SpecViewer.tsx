import { Box, Text } from 'ink';
import chalk from 'chalk';

interface Props {
  content: string;
  maxHeight?: number;
}

function renderLine(line: string, index: number) {
  // H1/H2/H3 headers
  if (/^#{1,3} /.test(line)) {
    const text = line.replace(/^#{1,3} /, '');
    return <Text key={index}>{chalk.bold(text)}</Text>;
  }

  // Checkbox checked
  if (/^- \[x\] /i.test(line)) {
    const text = line.replace(/^- \[x\] /i, '');
    return (
      <Text key={index}>
        {chalk.green('☑')} {chalk.dim(text)}
      </Text>
    );
  }

  // Checkbox unchecked
  if (/^- \[ \] /.test(line)) {
    const text = line.replace(/^- \[ \] /, '');
    return (
      <Text key={index}>
        {'☐'} {text}
      </Text>
    );
  }

  // Bullet list
  if (/^- /.test(line)) {
    const text = line.replace(/^- /, '');
    return (
      <Text key={index}>
        {chalk.dim('•')} {text}
      </Text>
    );
  }

  // Default
  return <Text key={index}>{line}</Text>;
}

export default function SpecViewer({ content, maxHeight }: Props) {
  const lines = content.split('\n');
  const visibleLines =
    maxHeight !== undefined && lines.length > maxHeight
      ? lines.slice(0, maxHeight)
      : lines;

  return (
    <Box flexDirection="column">
      {visibleLines.map((line, i) => renderLine(line, i))}
    </Box>
  );
}
