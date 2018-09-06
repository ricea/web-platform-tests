'use strict';

if (self.importScripts) {
  self.importScripts('/resources/testharness.js');
  self.importScripts('../resources/test-utils.js');
  self.importScripts('../resources/rs-utils.js');
}

const error1 = new Error('error1');
error1.name = 'error1';

// Generic utility function used by several tests.
function arrayToReadableStream(array) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of array) {
        controller.enqueue(chunk);
      }
      controller.close();
    }
  });
}

// Example: concatenate an array of readable streams into a single readable stream.
function concatenateReadables(readables) {
  const ts = new TransformStream();
  let promise = Promise.resolve();
  for (const readable of readables) {
    promise = promise
        .then(() => readable.pipeTo(ts.writable, { preventClose: true }),
              reason => {
                return Promise.all([
                  ts.writable.abort(reason),
                  readable.cancel(reason)]);
              });
  }
  promise.then(() => ts.writable.getWriter().close(),
               reason => ts.writable.abort(reason))
      .catch(() => {});
  return ts.readable;
}

promise_test(() => {
  const readable = concatenateReadables([]);
  return readable.getReader().read().then(({ done }) => {
    assert_true(done);
  });
}, 'concatenateReadables should work with no readables');

promise_test(() => {
  const readable = concatenateReadables([arrayToReadableStream([0, 1])]);
  return readableStreamToArray(readable).then(array => assert_array_equals(array, [0, 1], 'array should match'));
}, 'concatenateReadables should work as a pass-through');

promise_test(() => {
  const readable = concatenateReadables([arrayToReadableStream([0, 1]), arrayToReadableStream([1, 2])]);
  return readableStreamToArray(readable).then(array => assert_array_equals(array, [0, 1, 1, 2], 'array should match'));
}, 'concanateReadables should concatenate readables');

promise_test(t => {
  const erroredReadable = new ReadableStream({
    start(controller) {
      controller.enqueue(2);
      controller.error(error1);
    }
  });
  const readable = concatenateReadables([arrayToReadableStream([1]), erroredReadable]);
  const reader = readable.getReader();
  return reader.read().then(({ value, done }) => {
    assert_false(done, 'done should be false');
    assert_equals(value, 1, 'value should be 1');
    return promise_rejects(t, error1, reader.read(), 'read() should reject');
  });
}, 'an errored readable should error the stream returned by concatenateReadables once it is reached');

promise_test(() => {
  let controller;
  const inReadable = new ReadableStream({
    start(c) {
      controller = c;
    }
  });
  const outReadable = concatenateReadables([inReadable]);
  const reader = outReadable.getReader();
  let readCalled = false;
  let savedValue;
  const readPromise = reader.read().then(({ value, done }) => {
    assert_false(done, 'done should be false');
    savedValue = value;
    readCalled = true;
  });
  return flushAsyncEvents().then(() => {
    assert_false(readCalled, 'readCalled should be false');
    controller.enqueue(1);
    return delay(0);
  }).then(() => {
    assert_true(readCalled, 'readCalled should be true');
    assert_equals(savedValue, 1, 'savedValue should be 1');
    return readPromise;
  }).then(() => {
    controller.close();
    return reader.read();
  }).then(({ done }) => {
    assert_true(done, 'done should be true');
  });
}, 'chunks should be available immediately on the stream returned by concatenateReadables');

promise_test(() => {
  const inReadables = [];
  const inCancelled = [false, false];
  for (let x = 0; x < 2; ++x) {
    inReadables[x] = new ReadableStream({
      cancel() {
        inCancelled[x] = true;
      }
    });
  }
  const readable = concatenateReadables(inReadables);
  const cancelPromise = readable.cancel(new Error('what'));
  return delay(0).then(() => {
    assert_array_equals(inCancelled, [true, true], 'both readable streams should have been cancelled');
    return cancelPromise;
  });
}, 'cancelling the stream returned by concatenateReadables should cancel all input readables');

// Example: convert a promise for a readable stream to a readable stream.
function promiseToReadable(promiseForReadable) {
  const ts = new TransformStream();
  promiseForReadable.then(readable => readable.pipeTo(ts.writable))
      .catch(reason => ts.writable.abort(reason))
      .catch(() => {});
  return ts.readable;
}

promise_test(() => {
  const promise = Promise.resolve(arrayToReadableStream([]));
  const readable = promiseToReadable(promise);
  return readable.getReader().read().then(({ done }) => {
    assert_true(done, 'done should be true');
  });
}, 'promiseToReadable should convert a promise to a readable stream');

promise_test(t => {
  const promiseForString = Promise.resolve('foo');
  const readable = promiseToReadable(promiseForString);
  return promise_rejects(t, new TypeError(), readable.getReader().read(), 'read() should reject');
}, 'promiseToReadable should error the stream it returned when the promise doesn\'t resolve to a readable stream');

promise_test(t => {

  const erroredReadable = new ReadableStream({
    pull() {
      throw error1;
    }
  });
  const promise = new Promise(resolve => resolve(erroredReadable));
  const readable = promiseToReadable(promise);
  return promise_rejects(t, error1, readable.getReader().read(),
                         'read() should reject');
}, 'promiseToReadable should error the output readable stream when the promised stream is errored');

promise_test(() => {
  let cancelCalled = false;
  const promise = Promise.resolve(new ReadableStream({
    cancel() {
      cancelCalled = true;
    }
  }));
  const readable = promiseToReadable(promise);
  const cancelPromise = readable.cancel();
  return delay(0).then(() => {
    assert_true(cancelCalled, 'cancel should be called');
    return cancelPromise;
  });
}, 'promiseToReadable should propagate cancellation back to the promised stream');

done();
