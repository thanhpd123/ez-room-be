export default [
    {
        ignores: ["node_modules/**", "dist/**", "data/**", "public/**", "perf-results/**", "test-report.txt", "prisma/**"]
    },
    {
        files: ["**/*.js"],
        languageOptions: {
            ecmaVersion: "latest",
            sourceType: "module",
            globals: {
                console: "readonly",
                process: "readonly",
                module: "readonly",
                __dirname: "readonly",
                require: "readonly",
                Buffer: "readonly",
                setTimeout: "readonly",
                clearTimeout: "readonly",
                setInterval: "readonly",
                clearInterval: "readonly",
                fetch: "readonly",
                AbortController: "readonly",
                URL: "readonly",
                URLSearchParams: "readonly",
                Blob: "readonly"
            }
        },
        rules: {
            "no-unused-vars": "warn",
            "no-undef": "error"
        }
    }
];