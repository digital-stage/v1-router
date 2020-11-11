module.exports = {
    extends: ['airbnb-typescript/base'],
    parserOptions: {
        project: './tsconfig.json'
    },
    rules: {
        "react/require-default-props": 0,
        "no-underscore-dangle": 0
    }
};
