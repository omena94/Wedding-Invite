import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizePhone,isValidPhone} from './validators.js';
test('台灣手機的國碼、空格與括號統一成同一筆聯絡資料',()=>{
  for(const phone of ['0912345678','+886 912-345-678','886(912)345678']) {
    assert.equal(normalizePhone(phone),'0912345678');assert.equal(isValidPhone(phone),true);
  }
  for(const phone of ['09','912345678','+88612345678','not-a-phone'])assert.equal(isValidPhone(phone),false);
});
