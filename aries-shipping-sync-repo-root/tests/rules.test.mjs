import test from 'node:test';
import assert from 'node:assert/strict';
import { extractFreeThreshold, rulesFromZone } from '../netlify/functions/lib/rules.mjs';
const rate=(amount,currency,conds=[])=>({active:true, methodConditions:conds,rateProvider:{__typename:'DeliveryRateDefinition',price:{amount:String(amount),currencyCode:currency}}});
const min=(amount,currency)=>({field:'TOTAL_PRICE',operator:'GREATER_THAN_OR_EQUAL_TO',conditionCriteria:{__typename:'MoneyV2',amount:String(amount),currencyCode:currency}});
test('extracts live UK £1,000 free rate',()=>assert.deepEqual(extractFreeThreshold(rate(0,'GBP',[min(1000,'GBP')])),{freeThreshold:1000,currency:'GBP'}));
test('ignores other currencies',()=>assert.equal(extractFreeThreshold(rate(0,'GBP',[min(1000,'USD')])),null));
test('ignores unconditional or bounded free methods',()=>{
  assert.equal(extractFreeThreshold(rate(0,'GBP')),null);
  assert.equal(extractFreeThreshold(rate(0,'GBP',[min(1000,'GBP'),{field:'TOTAL_PRICE',operator:'LESS_THAN_OR_EQUAL_TO',conditionCriteria:{__typename:'MoneyV2',amount:'2000',currencyCode:'GBP'}}])),null);
});
test('extracts matching standard shipping rate',()=>{
 const zone={zone:{name:'United Kingdom'},methodDefinitions:{pageInfo:{hasNextPage:false},nodes:[rate(7.5,'GBP'),rate(0,'GBP',[min(1000,'GBP')])]}};
 assert.deepEqual(rulesFromZone(zone),{currency:'GBP',freeThreshold:1000,standardShipping:7.5});
});
test('avoids false promises in zones with no free rate',()=>{
 const zone={zone:{name:'Europe'},methodDefinitions:{pageInfo:{hasNextPage:false},nodes:[rate(30,'EUR')]}};
 assert.equal(rulesFromZone(zone),null);
});
