/**
 * 输入框工具函数
 */

/**
 * 数字输入过滤函数
 * 立即过滤非法字符，返回合法的数字字符串
 * 
 * @param text - 输入的文本
 * @param maxDecimals - 最大小数位数（可选，不传则不限制小数位数）
 * @returns 过滤后的合法数字字符串
 * 
 * @example
 * ```ts
 * filterNumericInput('123.45', 2)   // '123.45'
 * filterNumericInput('123a', 2)     // '123'
 * filterNumericInput('abc', 2)      // ''
 * filterNumericInput('12.345', 2)   // '12.34'
 * filterNumericInput('00123', 2)    // '123'
 * ```
 */
export const filterNumericInput = (text: string, maxDecimals?: number): string => {
    // 空字符串直接返回
    if (text === '') return '';

    // 移除所有非数字和非小数点的字符
    let filtered = text.replace(/[^0-9.]/g, '');

    // 过滤后为空则返回空
    if (filtered === '') return '';

    // 处理多个小数点：只保留第一个小数点
    const firstDotIndex = filtered.indexOf('.');
    if (firstDotIndex !== -1) {
        filtered = filtered.slice(0, firstDotIndex + 1) +
            filtered.slice(firstDotIndex + 1).replace(/\./g, '');
    }

    // 处理前导零（允许 "0" 和 "0.xxx"，不允许 "00" 或 "007"）
    while (filtered.length > 1 && filtered[0] === '0' && filtered[1] !== '.') {
        filtered = filtered.slice(1);
    }

    // 限制小数位数
    if (maxDecimals !== undefined && maxDecimals >= 0) {
        const parts = filtered.split('.');
        if (parts.length === 2 && parts[1].length > maxDecimals) {
            if (maxDecimals === 0) {
                filtered = parts[0];
            } else {
                filtered = parts[0] + '.' + parts[1].slice(0, maxDecimals);
            }
        }
    }

    return filtered;
};

/**
 * 创建带小数位数限制的数字输入处理函数
 * 便于直接作为 TextInput 的 onChangeText 回调
 * 
 * @param setter - 状态设置函数
 * @param maxDecimals - 最大小数位数（可选）
 * @returns onChangeText 回调函数
 * 
 * @example
 * ```tsx
 * const [amount, setAmount] = useState('');
 * 
 * <TextInput
 *   value={amount}
 *   onChangeText={createNumericInputHandler(setAmount, 4)}
 * />
 * ```
 */
export const createNumericInputHandler = (
    setter: (value: string) => void,
    maxDecimals?: number
): ((text: string) => void) => {
    return (text: string) => {
        setter(filterNumericInput(text, maxDecimals));
    };
};

/**
 * 常用小数位数配置
 */
export const INPUT_DECIMAL_PRESETS = {
    /** 价格：最多 8 位小数 */
    PRICE: 8,
    /** 数量：最多 8 位小数 */
    AMOUNT: 8,
    /** 金额：最多 4 位小数 */
    TOTAL: 4,
    /** 法币金额：最多 2 位小数 */
    FIAT: 2,
    /** 整数：不允许小数 */
    INTEGER: 0,
} as const;

