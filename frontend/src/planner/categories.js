// 花費類別：從後台讀取。讀不到時退回內建清單，表單不會因此開不了。
import { useCallback, useEffect, useState } from "react";
import { fetchCategories } from "../api.js";
import { EXPENSE_CATEGORIES } from "../constants.js";

const FALLBACK = EXPENSE_CATEGORIES.map((name, i) => ({ id: -(i + 1), name, sort_order: i, vendor_count: 0, expense_count: 0 }));

export function useCategories() {
  const [list, setList] = useState(null);
  const reload = useCallback(
    () => fetchCategories().then(setList).catch(() => setList(FALLBACK)),
    []
  );
  useEffect(() => {
    reload();
  }, [reload]);
  const items = list || [];
  const names = items.map((c) => c.name);
  return {
    list: items,
    loaded: list !== null,
    names,
    options: names.map((n) => ({ value: n, label: n })),
    reload,
    setList,
  };
}
