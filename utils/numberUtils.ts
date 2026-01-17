/**
 * Formats a number with adaptive precision based on its magnitude.
 * 
 * Rules:
 * - If value < 0.000001 (Micro) -> Up to 10 decimals (e.g., 0.00000012)
 * - If value < 0.001 (Low Cap) -> Up to 8 decimals (e.g., 0.00056789)
 * - If value < 1 (Sub-Dollar) -> 4-6 decimals (e.g., 0.123456)
 * - If value < 1000 (Standard) -> 2-3 decimals (e.g., 123.45)
 * - If value >= 1000 (High Value) -> 2 decimals (e.g., 65000.00)
 * 
 * @param value The number to format
 * @param options Intl.NumberFormatOptions
 * @returns Formatted string
 */
export const formatNumber = (value: number | undefined | null, options?: Intl.NumberFormatOptions): string => {
    if (value === null || value === undefined || isNaN(value)) return "N/A";
    if (value === 0) return "0.00";

    const absVal = Math.abs(value);
    let decimals = 2; // Default

    if (absVal < 0.000001) {
        decimals = 10;
    } else if (absVal < 0.001) {
        decimals = 8;
    } else if (absVal < 1) {
        decimals = 6;
    } else if (absVal < 10) {
        decimals = 4;
    } else if (absVal < 1000) {
        decimals = 2;
    } else {
        decimals = 2;
    }

    // Override with options if provided, otherwise use adaptive
    const maxFractionDigits = options?.maximumFractionDigits ?? decimals;
    const minFractionDigits = options?.minimumFractionDigits ?? (decimals > 2 ? 2 : 2);

    return new Intl.NumberFormat('en-US', {
        minimumFractionDigits: minFractionDigits,
        maximumFractionDigits: maxFractionDigits,
        ...options
    }).format(value);
};

/**
 * Formats a number specifically for currency display (USD).
 */
export const formatCurrency = (value: number | undefined | null): string => {
    if (value === null || value === undefined || isNaN(value)) return "$0.00";
    // We treat currency similar to number but add $ sign, 
    // relying on formatNumber for the smart decimal logic.
    return "$" + formatNumber(value);
};
