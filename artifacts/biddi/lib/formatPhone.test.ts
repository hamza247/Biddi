import { formatPhoneDisplay } from "./formatPhone";

describe("formatPhoneDisplay", () => {
  describe("+1 US/Canada", () => {
    it("formats a valid 10-digit US number", () => {
      expect(formatPhoneDisplay("+12025551234")).toBe("+1 (202) 555-1234");
    });

    it("formats a valid 10-digit Canadian number", () => {
      expect(formatPhoneDisplay("+16045559876")).toBe("+1 (604) 555-9876");
    });

    it("returns raw E.164 when digit count is wrong (9 digits)", () => {
      expect(formatPhoneDisplay("+1202555123")).toBe("+1202555123");
    });

    it("returns raw E.164 when digit count is wrong (11 digits)", () => {
      expect(formatPhoneDisplay("+120255512345")).toBe("+120255512345");
    });
  });

  describe("+212 Morocco", () => {
    it("formats a valid 9-digit Moroccan number", () => {
      expect(formatPhoneDisplay("+212612345678")).toBe("+212 612-345-678");
    });

    it("returns raw E.164 when digit count is wrong (8 digits)", () => {
      expect(formatPhoneDisplay("+21261234567")).toBe("+21261234567");
    });

    it("returns raw E.164 when digit count is wrong (10 digits)", () => {
      expect(formatPhoneDisplay("+2126123456789")).toBe("+2126123456789");
    });
  });

  describe("+44 UK", () => {
    it("formats a valid 10-digit UK number", () => {
      expect(formatPhoneDisplay("+447911123456")).toBe("+44 7911 123456");
    });

    it("returns raw E.164 when digit count is wrong (9 digits)", () => {
      expect(formatPhoneDisplay("+44791112345")).toBe("+44791112345");
    });

    it("returns raw E.164 when digit count is wrong (11 digits)", () => {
      expect(formatPhoneDisplay("+4479111234567")).toBe("+4479111234567");
    });
  });

  describe("+33 France", () => {
    it("formats a valid 9-digit French number", () => {
      expect(formatPhoneDisplay("+33612345678")).toBe("+33 6 12 34 56 78");
    });

    it("returns raw E.164 when digit count is wrong (8 digits)", () => {
      expect(formatPhoneDisplay("+3361234567")).toBe("+3361234567");
    });

    it("returns raw E.164 when digit count is wrong (10 digits)", () => {
      expect(formatPhoneDisplay("+336123456789")).toBe("+336123456789");
    });
  });

  describe("+971 UAE", () => {
    it("formats a valid 9-digit UAE number", () => {
      expect(formatPhoneDisplay("+971501234567")).toBe("+971 50 123 4567");
    });

    it("returns raw E.164 when digit count is wrong (8 digits)", () => {
      expect(formatPhoneDisplay("+97150123456")).toBe("+97150123456");
    });

    it("returns raw E.164 when digit count is wrong (10 digits)", () => {
      expect(formatPhoneDisplay("+9715012345678")).toBe("+9715012345678");
    });
  });

  describe("unrecognized prefix (E.164 fallback)", () => {
    it("returns the number as-is for an unrecognized country code (+49 Germany)", () => {
      expect(formatPhoneDisplay("+4915112345678")).toBe("+4915112345678");
    });

    it("returns the number as-is for another unrecognized prefix (+81 Japan)", () => {
      expect(formatPhoneDisplay("+819012345678")).toBe("+819012345678");
    });

    it("returns the number as-is for +55 Brazil", () => {
      expect(formatPhoneDisplay("+5511987654321")).toBe("+5511987654321");
    });
  });
});
