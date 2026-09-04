import { createContext, useContext } from "react";

// 籌備後台的登入狀態：role（couple 新人 / helper 幫手）與 logout()
export const PlannerContext = createContext({ role: "couple", logout: () => {} });
export const usePlanner = () => useContext(PlannerContext);
