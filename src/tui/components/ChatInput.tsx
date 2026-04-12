import { useState } from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';
import chalk from 'chalk';

interface Props {
  onSubmit: (text: string) => void;
  placeholder?: string;
  prefix?: string;
}

export default function ChatInput({ onSubmit, placeholder = '', prefix = '' }: Props) {
  const [value, setValue] = useState('');

  function handleSubmit(submitted: string) {
    const trimmed = submitted.trim();
    if (trimmed) {
      onSubmit(trimmed);
      setValue('');
    }
  }

  return (
    <Box flexDirection="row" gap={0}>
      {prefix ? <Text>{chalk.cyan(prefix)}</Text> : null}
      <TextInput
        value={value}
        onChange={setValue}
        onSubmit={handleSubmit}
        placeholder={placeholder}
      />
    </Box>
  );
}
