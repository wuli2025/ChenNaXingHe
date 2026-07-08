export default {
  test: {
    environment: "happy-dom",
    include: ["src/**/*.test.ts"],
    globals: true,
    poolOptions: { threads: { singleThread: true } },
  },
};
