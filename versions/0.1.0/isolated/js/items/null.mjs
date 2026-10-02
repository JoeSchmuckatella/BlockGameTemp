"use strict";import{Item}from"./item.mjs";export class Null extends Item{class;constructor(count=1){super(count);this.class=Null;this.hash=BigInt(Null.ID)}}
