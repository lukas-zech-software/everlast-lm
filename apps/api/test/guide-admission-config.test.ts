import { expect, it } from "vitest";
import { loadGuideAdmissionConfig } from "../src/config.ts";
/** [008-studio-text-reports] T072/T074 — FR-SI-02/FR-ST-11/NFR-SEC-02. */
it("validates configurable Guide admission defaults and rejects invalid bounds",()=>{
 expect(loadGuideAdmissionConfig({})).toEqual({maxConcurrent:2,maxStartsPerHour:20});
 expect(loadGuideAdmissionConfig({GUIDE_MAX_CONCURRENT:"3",GUIDE_MAX_STARTS_PER_HOUR:"25"})).toEqual({maxConcurrent:3,maxStartsPerHour:25});
 for(const value of ["0","-1","NaN","1.5",""])expect(()=>loadGuideAdmissionConfig({GUIDE_MAX_CONCURRENT:value})).toThrow();
});
