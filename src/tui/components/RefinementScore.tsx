import { Box, Text } from 'ink';
import chalk from 'chalk';

interface ScoreEntry {
  iteration: number;
  score: number;
}

interface Props {
  scores: ScoreEntry[];
  target?: number;
}

const BAR_WIDTH = 20;
const FILLED = '█';
const EMPTY = '░';

function renderBar(score: number): string {
  const filled = Math.round(score * BAR_WIDTH);
  const empty = BAR_WIDTH - filled;
  return FILLED.repeat(filled) + EMPTY.repeat(empty);
}

export default function RefinementScore({ scores, target }: Props) {
  if (scores.length === 0) {
    return (
      <Box>
        <Text>{chalk.dim('No scores yet')}</Text>
      </Box>
    );
  }

  const lastIndex = scores.length - 1;

  return (
    <Box flexDirection="column">
      {target !== undefined && (
        <Box marginBottom={1}>
          <Text>{chalk.dim(`Target: ${Math.round(target * 100)}%`)}</Text>
        </Box>
      )}
      {scores.map((entry, i) => {
        const isLast = i === lastIndex;
        const bar = renderBar(entry.score);
        const pct = Math.round(entry.score * 100);
        const arrow = isLast ? chalk.yellow(' ◄') : '';
        const barColor = isLast ? chalk.cyan : chalk.dim;

        return (
          <Box key={entry.iteration} flexDirection="row" gap={1}>
            <Text>{chalk.dim(`#${entry.iteration}`)}</Text>
            <Text>{barColor(bar)}</Text>
            <Text>{chalk.bold(`${pct}%`)}{arrow}</Text>
          </Box>
        );
      })}
    </Box>
  );
}
