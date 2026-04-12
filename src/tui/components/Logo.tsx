import { Box, Text } from 'ink';
import chalk from 'chalk';

const ASCII_ART = `
 ███╗   ███╗ █████╗ ██████╗
 ████╗ ████║██╔══██╗██╔══██╗
 ██╔████╔██║███████║██████╔╝
 ██║╚██╔╝██║██╔══██║██╔═══╝
 ██║ ╚═╝ ██║██║  ██║██║
 ╚═╝     ╚═╝╚═╝  ╚═╝╚═╝
`.trim();

const TAGLINE = 'Multi-Agent Pipeline — iterative spec-refinement for one-shot TDD';

export default function Logo() {
  return (
    <Box flexDirection="column" alignItems="center">
      <Text>{chalk.cyan(ASCII_ART)}</Text>
      <Text>{chalk.dim(TAGLINE)}</Text>
    </Box>
  );
}
