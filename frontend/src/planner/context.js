import { createContext, useContext } from "react";

// 籌備後台的登入狀態：role（couple 新人 / helper 幫手）、perms（能用的功能鑰匙，設定頁可調）、can(key)、logout()
export const PlannerContext = createContext({ role: "couple", perms: new Set(), can: () => false, logout: () => {} });
export const usePlanner = () => useContext(PlannerContext);
