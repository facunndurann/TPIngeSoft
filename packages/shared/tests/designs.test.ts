import { test } from 'vitest'
import assert from 'node:assert/strict'
import { DEFAULT_MENU_DESIGN } from '../src/designs.ts'
import { definitionOf } from './schema-snapshot.ts'

test('the database default menu design matches DEFAULT_MENU_DESIGN', () => {
  const column = definitionOf('TABLE', 'restaurants').match(/"menu_design" "public"\."menu_design" DEFAULT '(\w+)'/)
  assert.ok(column, 'restaurants.menu_design tiene que tener un default')
  assert.equal(column[1], DEFAULT_MENU_DESIGN)
})
