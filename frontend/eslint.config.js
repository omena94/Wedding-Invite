import globals from 'globals';
import hooks from 'eslint-plugin-react-hooks';

export default [
  {ignores:['dist/**','node_modules/**']},
  {files:['src/**/*.{js,jsx}'],languageOptions:{ecmaVersion:'latest',sourceType:'module',globals:globals.browser,parserOptions:{ecmaFeatures:{jsx:true}}},plugins:{'react-hooks':hooks},rules:{'no-undef':'error','no-dupe-keys':'error','no-unreachable':'error','no-const-assign':'error','react-hooks/rules-of-hooks':'error'}},
  {files:['**/*.test.js'],languageOptions:{globals:globals.node}},
];
