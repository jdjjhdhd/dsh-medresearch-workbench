/**
 * 宿主入口：只组装 src/host/routes.js 的 name/inject/apply。
 * 宿主半不 import 任何 SDK 包实现；所有能力通过 ctx.get(name) 运行时取。
 */
export { apply, inject, name, __internals } from '../src/host/routes.js';
