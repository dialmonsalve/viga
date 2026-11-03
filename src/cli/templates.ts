export type SchemaLibrary = 'zod' | 'valibot';

export interface Names {
  file: string;
  route: string;
  variable: string;
  plural: string;
  singular: string;
}

function pascal(name: string) {
  return name
    .split('-')
    .map((part) => `${part[0]?.toUpperCase()}${part.slice(1)}`)
    .join('');
}

function singularize(name: string) {
  if (name.endsWith('ies')) return `${name.slice(0, -3)}y`;
  if (name.endsWith('ss') || !name.endsWith('s')) return name;
  return name.slice(0, -1);
}

export function namesOf(name: string): Names {
  const plural = pascal(name);
  return {
    file: name,
    route: `/${name}`,
    variable: `${plural[0]?.toLowerCase()}${plural.slice(1)}`,
    plural,
    singular: pascal(singularize(name)),
  };
}

export function moduleTemplate({ plural }: Names, parts: { controller: boolean; service: boolean; file: string }) {
  const imports = ["import { Module } from '@vigajs/core';"];
  const options: string[] = [];
  if (parts.controller) {
    imports.push(`import { ${plural}Controller } from './${parts.file}.controller.ts';`);
    options.push(`  controllers: [${plural}Controller],`);
  }
  if (parts.service) {
    imports.push(`import { ${plural}Service } from './${parts.file}.service.ts';`);
    options.push(`  providers: [${plural}Service],`);
  }
  const body = options.length > 0 ? `{\n${options.join('\n')}\n}` : '{}';
  return `${imports.join('\n')}\n\n@Module(${body})\nexport class ${plural}Module {}\n`;
}

export function controllerTemplate({ plural, route }: Names) {
  return `import { Controller, Get } from '@vigajs/core';

@Controller('${route}')
export class ${plural}Controller {
  @Get()
  findAll() {
    return [];
  }
}
`;
}

export function serviceTemplate({ plural }: Names) {
  return `import { Injectable } from '@vigajs/core';

@Injectable()
export class ${plural}Service {}
`;
}

export function schemasTemplate({ singular }: Names, library: SchemaLibrary) {
  if (library === 'valibot') {
    return `import * as v from 'valibot';

export const Create${singular} = v.strictObject({
  name: v.pipe(v.string(), v.minLength(1)),
});

export const Update${singular} = v.partial(Create${singular});

export const ${singular}Params = v.object({
  id: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)),
});
`;
  }
  return `import { z } from 'zod';

export const Create${singular} = z.strictObject({
  name: z.string().min(1),
});

export const Update${singular} = Create${singular}.partial();

export const ${singular}Params = z.object({
  id: z.coerce.number().int().positive(),
});
`;
}

export function resourceServiceTemplate({ plural, singular }: Names) {
  return `import { Injectable, NotFoundException } from '@vigajs/core';

export interface ${singular} {
  id: number;
  name: string;
}

@Injectable()
export class ${plural}Service {
  private readonly items = new Map<number, ${singular}>();
  private nextId = 1;

  findAll() {
    return [...this.items.values()];
  }

  findOne(id: number) {
    const item = this.items.get(id);
    if (!item) throw new NotFoundException();
    return item;
  }

  create(data: { name: string }) {
    const item = { id: this.nextId++, ...data };
    this.items.set(item.id, item);
    return item;
  }

  update(id: number, data: { name?: string | undefined }) {
    const item = { ...this.findOne(id), ...(data.name === undefined ? {} : { name: data.name }) };
    this.items.set(id, item);
    return item;
  }

  remove(id: number) {
    this.findOne(id);
    this.items.delete(id);
  }
}
`;
}

export function resourceControllerTemplate({ file, plural, route, singular, variable }: Names) {
  return `import { Controller, Delete, Get, Patch, Post, inject, type HttpContext } from '@vigajs/core';
import { Validate } from '@vigajs/validation';
import { Create${singular}, ${singular}Params, Update${singular} } from './${file}.schemas.ts';
import { ${plural}Service } from './${file}.service.ts';

@Controller('${route}')
export class ${plural}Controller {
  private readonly ${variable} = inject(${plural}Service);

  @Get()
  findAll() {
    return this.${variable}.findAll();
  }

  @Get('/:id')
  @Validate({ params: ${singular}Params })
  findOne({ params }: HttpContext<{ params: typeof ${singular}Params }>) {
    return this.${variable}.findOne(params.id);
  }

  @Post()
  @Validate({ body: Create${singular} })
  create({ body }: HttpContext<{ body: typeof Create${singular} }>) {
    return this.${variable}.create(body);
  }

  @Patch('/:id')
  @Validate({ params: ${singular}Params, body: Update${singular} })
  update({ params, body }: HttpContext<{ params: typeof ${singular}Params; body: typeof Update${singular} }>) {
    return this.${variable}.update(params.id, body);
  }

  @Delete('/:id')
  @Validate({ params: ${singular}Params })
  remove({ params }: HttpContext<{ params: typeof ${singular}Params }>) {
    this.${variable}.remove(params.id);
  }
}
`;
}
