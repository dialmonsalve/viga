import * as v from 'valibot';

export const CreateAuthor = v.strictObject({
  name: v.pipe(v.string(), v.minLength(1)),
});

export const UpdateAuthor = v.partial(CreateAuthor);

export const AuthorParams = v.object({
  id: v.pipe(v.string(), v.transform(Number), v.integer(), v.minValue(1)),
});
