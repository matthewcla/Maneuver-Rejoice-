module.exports = {
  transform: { '^.+\\.tsx?$': 'ts-jest' },
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/**/*.test.ts?(x)', '<rootDir>/src/tests/**/*.test.ts?(x)']
};
