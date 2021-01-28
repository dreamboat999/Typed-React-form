import React from "react";
import { useEffect, useRef, useState } from "react";

export type ListenerCallback = (setValuesWasUsed: boolean) => void;
export type ListenerMap = { [T in string]?: ListenerCallback };
export type Validator<T, Error> = (values: T) => ErrorMap<T, Error>;

type ChildFormMap<T, State, Error> = {
    [Key in keyof T]?: ChildFormState<T, State, Error, Key>;
};

type DirtyMap<T> = {
    [Key in keyof T]?: boolean;
};

type ObjectOrArray = {
    [key: string]: any;
    [key: number]: any;
};

type ErrorType<T, Error> = T extends ObjectOrArray ? ErrorMap<T, Error> : Error;

type ErrorMap<T, Error> = {
    [Key in keyof T]?: ErrorType<T[Key], Error>;
};

export type DefaultError = string;
export type DefaultState = { isSubmitting: boolean };

function memberCopy<T>(value: T): T {
    if (Array.isArray(value)) {
        return [...value] as any;
    } else if (typeof value === "object") {
        return { ...value };
    } else {
        throw new Error("Can only memberCopy() arrays and objects.");
    }
}

export class FormState<T, State = DefaultState, Error = DefaultError> {
    public values: T;
    public defaultValues: T;
    public childMap: ChildFormMap<T, State, Error> = {};
    public dirtyMap: DirtyMap<T> = {};
    public errorMap: ErrorMap<T, Error> = {};
    public listeners: { [Key in keyof T]?: ListenerMap } = {};
    public anyListeners: ListenerMap = {};
    public formId = ++FormState.formCounter;
    public state: State;
    public validator?: Validator<T, Error>;
    public validateOnChange: boolean;

    private static formCounter = 0;
    private counter = 0;

    public constructor(
        values: T,
        defaultValues: T,
        defaultState: State,
        validator?: Validator<T, Error>,
        validateOnChange = true
    ) {
        this.values = memberCopy(values);
        this.defaultValues = memberCopy(defaultValues);
        this.state = memberCopy(defaultState);
        this.validator = validator;
        this.validateOnChange = validateOnChange;
    }

    public get dirty() {
        return Object.keys(this.dirtyMap).some((e) => this.dirtyMap[e]);
    }

    public get error() {
        return Object.keys(this.errorMap).some((e) => this.errorMap[e]);
    }

    public setValueInternal<Key extends keyof T>(
        key: Key,
        value: T[Key] | undefined,
        dirty: boolean | undefined,
        validate: boolean,
        isDefault: boolean,
        notifyChild: boolean,
        notifyParent: boolean,
        fireAny: boolean
    ) {
        console.log(
            this.formId,
            "setValueInternal",
            key,
            value,
            dirty,
            isDefault
        );
        let map = isDefault ? this.defaultValues : this.values;
        if (value === undefined) {
            if (Array.isArray(map)) map.splice(key as number, 1);
            else delete map[key];
        } else {
            map[key] = value;
        }

        if (dirty !== undefined) this.dirtyMap[key] = dirty;

        if (notifyChild && value !== undefined) {
            let child = this.childMap[key];
            if (child) {
                child.setValues(value, isDefault, true, false);
                this.dirtyMap[key] = child.dirty;
            }
        }

        this.fireListeners(key, false);
        if (fireAny) {
            // Will be false when using setValues, he will call fireAnyListeners and notifyParentValues itself
            if (notifyParent) this.updateParentValues(isDefault);
            this.fireAnyListeners(false);
        }

        if (this.validator && validate) this.validate();
    }

    protected updateParentValues(_isDefault: boolean) {
        // Not implemented for root form, as it does not have a parent
    }

    protected updateParentErrors() {
        // Not implemented for root form, as it does not have a parent
    }

    protected updateParentState() {
        // Not implemented for root form, as it does not have a parent
    }

    public setValue<Key extends keyof T>(
        key: Key,
        value: T[Key] | undefined,
        validate: boolean = true,
        isDefault: boolean = false,
        notifyChild: boolean = true,
        notifyParent: boolean = true,
        fireAny: boolean = true
    ) {
        if (typeof value === "object") {
            this.setValueInternal(
                key,
                value,
                undefined,
                validate,
                isDefault,
                notifyChild,
                notifyParent,
                fireAny
            );
        } else {
            if (
                (isDefault && this.defaultValues[key] === value) ||
                (!isDefault && this.values[key] === value)
            ) {
                console.log(
                    this.formId,
                    "already set",
                    value,
                    isDefault ? this.defaultValues[key] : this.values[key]
                );
                return false;
            }
            this.setValueInternal(
                key,
                value,
                isDefault
                    ? value !== this.values[key]
                    : value !== this.defaultValues[key],
                validate,
                isDefault,
                notifyChild,
                notifyParent,
                fireAny
            );
        }
        return true;
    }

    public setValues(
        values: T,
        isDefault: boolean = false,
        notifyChild: boolean = true,
        notifyParent: boolean = true
    ) {
        console.log(this.formId, "setValues", values, isDefault);

        // Copy the values to the local form object
        let newKeys = Object.keys(isDefault ? this.defaultValues : this.values);
        let localKeys = Object.keys(values);
        let mostKeys = newKeys.length > localKeys.length ? newKeys : localKeys;
        for (let i = 0; i < mostKeys.length; i++) {
            let key = mostKeys[i] as keyof T;
            this.setValue(
                key,
                values[key],
                false, // Will validate after all values are copied
                isDefault,
                notifyChild,
                notifyParent,
                false // Will call fireAnyListener after all values are copied, see 3 lines down
            );
        }
        if (notifyParent) this.updateParentValues(isDefault);
        this.fireAnyListeners(true);

        if (this.validator) this.validate();
    }

    public validate() {
        if (!this.validator) {
            console.warn(
                "validate() was called on a form which does not have a validator set."
            );
            return;
        }
        this.setErrors(this.validator(this.values));
    }

    public setError<Key extends keyof T>(
        key: Key,
        error: ErrorType<T[Key], Error> | undefined,
        notifyChild: boolean = true,
        notifyParent: boolean = true,
        fireAny: boolean = true
    ) {
        if (this.errorMap[key] === error) return;

        if (!error) delete this.errorMap[key];
        else this.errorMap[key] = error;

        if (notifyChild) this.childMap[key]?.setErrors((error ?? {}) as any);
        this.fireListeners(key, false);
        if (fireAny) {
            if (notifyParent) this.updateParentErrors();
            this.fireAnyListeners(false);
        }
    }

    public setErrors(
        errors: ErrorMap<T, Error>,
        notifyChild: boolean = true,
        notifyParent: boolean = true
    ) {
        let localKeys = Object.keys(this.errorMap);
        let newKeys = Object.keys(errors);
        let mostKeys = newKeys.length > localKeys.length ? newKeys : localKeys;
        for (let i = 0; i < mostKeys.length; i++) {
            let key = mostKeys[i] as keyof T;
            this.setError(
                key,
                errors[key] as any,
                notifyChild,
                notifyParent,
                false // Will call fireAnyListener by itself, see 3 lines down
            );
        }
        if (notifyParent) this.updateParentErrors();
        this.fireAnyListeners(false);
    }

    public resetAll() {
        this.setValues(this.defaultValues);
    }

    public reset(key: keyof T) {
        this.setValue(key, this.defaultValues[key]);
    }

    public setState(
        state: State,
        notifyChild: boolean = true,
        notifyParent: boolean = true
    ) {
        this.state = state;

        let c = Object.keys(this.values);
        if (notifyChild)
            c.forEach((e) =>
                this.childMap[e]?.setState(state, notifyChild, notifyParent)
            );

        c.forEach((e) => this.fireListeners(e as keyof T, false));
        if (notifyParent) this.updateParentState();
        this.fireAnyListeners(false);
    }

    public listen(key: keyof T, listener: ListenerCallback): string {
        if (!this.listeners) this.listeners = {};
        let setters = this.listeners[key];
        if (!setters) {
            setters = {};
            this.listeners[key] = setters;
        }
        let id = "" + this.counter++;
        setters[id] = listener;
        return id;
    }

    public listenAny(listener: ListenerCallback) {
        if (!this.anyListeners) this.anyListeners = {};
        let id = "" + this.counter++;
        this.anyListeners[id] = listener;
        return id;
    }

    public ignoreAny(id: string) {
        if (!this.anyListeners) return;
        delete this.anyListeners[id];
    }

    public ignore(key: keyof T, id: string) {
        if (!this.listeners) return;
        let setters = this.listeners[key];
        if (!setters) {
            console.warn("Ignore was called for no reason", key, id);
            return;
        }
        delete setters[id];
    }

    protected fireListeners(key: keyof T, setValuesWasUsed: boolean) {
        let a = this.listeners[key];
        if (a) {
            let l = Object.keys(a!);
            l.forEach((e) => a![e]!(setValuesWasUsed));
        }
    }

    protected fireAnyListeners(setValuesWasUsed: boolean) {
        let al = Object.keys(this.anyListeners);
        al.forEach((e) => this.anyListeners[e]!(setValuesWasUsed));
    }
}

export class ChildFormState<
    Parent,
    ParentState,
    ParentError,
    Key extends keyof Parent
> extends FormState<Parent[Key], ParentState, ParentError> {
    public name: Key;
    public parent: FormState<Parent, ParentState, ParentError>;

    public constructor(
        parent: FormState<Parent, ParentState, ParentError>,
        name: Key
    ) {
        super(
            parent.values[name] ?? ({} as any),
            parent.defaultValues[name] ?? ({} as any),
            parent.state
        );
        this.parent = parent;
        this.name = name;
        parent.childMap[name] = this;
    }

    protected updateParentValues(isDefault: boolean) {
        this.parent.setValueInternal(
            this.name,
            isDefault
                ? memberCopy(this.defaultValues)
                : memberCopy(this.values),
            this.dirty,
            true,
            isDefault,
            false,
            true,
            true
        );
    }

    protected updateParentErrors() {
        this.parent.setError(
            this.name,
            this.error ? (memberCopy(this.errorMap) as any) : undefined,
            false,
            true
        );
    }

    protected updateParentState() {
        this.parent.setState(memberCopy(this.state), false, true);
    }
}

export function useForm<T, State = DefaultState, Error = DefaultError>(
    defaultValues: T,
    defaultState: State,
    validator?: Validator<T, Error>,
    validateOnChange = true
) {
    let c = useRef<FormState<T, State, Error> | null>(null);

    if (!c.current) {
        c.current = new FormState(
            defaultValues,
            defaultValues,
            defaultState,
            validator,
            validateOnChange
        );
    }

    useEffect(() => {
        c.current!.setValues(defaultValues, true);
    }, [defaultValues]);

    return c.current;
}

export function useChildForm<T, State, Error, Key extends keyof T>(
    parentForm: FormState<T, State, Error>,
    name: Key
) {
    let c = useRef<ChildFormState<T, State, Error, Key> | null>(null);
    if (!c.current) {
        c.current = new ChildFormState(parentForm, name);
    }

    useEffect(() => {
        c.current!.setValues(
            parentForm.values[name] ?? ({} as any),
            false,
            true,
            false
        );
        return () => {
            delete parentForm.errorMap[name];
            delete parentForm.dirtyMap[name];
        };
    }, [parentForm, name]);

    return c.current;
}

export function useListener<T, State, Error, Key extends keyof T>(
    form: FormState<T, State, Error>,
    name: Key
) {
    const [, setRender] = useState(0);

    useEffect(() => {
        let id = form.listen(name, () => setRender((e) => e + 1));
        return () => form.ignore(name, id);
    }, [form, name]);

    return {
        value: form.values[name],
        defaultValue: form.defaultValues[name],
        setValue: (value: T[Key]) => form.setValue(name, value),
        dirty: form.dirtyMap[name],
        error: form.errorMap[name],
        state: form.state,
        form
    };
}

export function useAnyListener<T, State, Error>(
    form: FormState<T, State, Error>,
    onlyOnSetValues = false
) {
    const [, setRender] = useState(0);

    useEffect(() => {
        let id = form.listenAny((all) => {
            if (form.formId === 3) console.trace("all?", all);
            if (!onlyOnSetValues || all) setRender((e) => e + 1);
        });
        return () => form.ignoreAny(id);
    }, [form]);

    return form;
}

export function useArrayForm<
    Parent extends ObjectOrArray,
    ParentState extends ObjectOrArray,
    ParentError,
    Key extends keyof Parent
>(parent: FormState<Parent, ParentState, ParentError>, name: Key) {
    const form = useChildForm<Parent, ParentState, ParentError, Key>(
        parent,
        name
    );
    useAnyListener(form, true);

    function append(value: Parent[Key][number]) {
        form.setValues([...(form.values as any), value] as any);
    }

    function remove(index: number) {
        let newValues = [...(form.values as any)];
        newValues.splice(index, 1);
        form.setValues(newValues as any);
    }

    function clear() {
        form.setValues([] as any);
    }

    function move(from: number, to: number) {
        if (to === from) return;
        let newArr = [...(form.values as any)];
        var target = newArr[from];
        var increment = to < from ? -1 : 1;
        for (var k = from; k !== to; k += increment) {
            newArr[k] = newArr[k + increment];
        }
        newArr[to] = target;
        form.setValues(newArr as any);
    }

    function swap(index: number, newIndex: number) {
        if (index === newIndex) {
            return;
        }
        let values = [...(form.values as any)];
        [values[index], values[newIndex]] = [values[newIndex], values[index]];
        form.setValues(values as any);
    }

    return {
        remove,
        move,
        swap,
        clear,
        append,
        form: form,
        values: form.values,
        setValues: form.setValues
    };
}

export function ArrayForm<
    Parent extends ObjectOrArray,
    ParentState extends ObjectOrArray,
    ParentError,
    Key extends keyof Parent
>(props: {
    parent: FormState<Parent, ParentState, ParentError>;
    name: Key;
    children: (props: {
        form: FormState<Parent[Key], ParentState, ParentError>;
        remove: (index: number) => void;
        clear: () => void;
        move: (index: number, newIndex: number) => void;
        swap: (index: number, newIndex: number) => void;
        append: (value: Parent[Key][number]) => void;
        values: Parent[Key];
        setValues: (values: Parent[Key]) => void;
    }) => React.ReactNode;
}) {
    const arr = useArrayForm(props.parent, props.name);
    return <React.Fragment>{props.children(arr)}</React.Fragment>;
}

export function Listener<
    T extends ObjectOrArray,
    State extends ObjectOrArray,
    Error,
    Key extends keyof T
>(props: {
    form: FormState<T, State, Error>;
    name: Key;
    children: (props: {
        value: T[Key];
        defaultValue: T[Key];
        setValue: (value: T[Key]) => boolean;
        dirty: DirtyMap<T>[Key];
        error: ErrorMap<T, Error>[Key];
        state: State;
        form: FormState<T, State, Error>;
    }) => React.ReactNode;
}) {
    const l = useListener(props.form, props.name);
    return <React.Fragment>{props.children(l)}</React.Fragment>;
}

export function AnyListener<
    T extends ObjectOrArray,
    State extends ObjectOrArray,
    Error
>(props: {
    form: FormState<T, State, Error>;
    children: (props: FormState<T, State, Error>) => React.ReactNode;
}) {
    const l = useAnyListener(props.form);
    return <React.Fragment>{props.children(l)}</React.Fragment>;
}

export function ChildForm<
    Parent extends ObjectOrArray,
    ParentState extends ObjectOrArray,
    ParentError,
    Key extends keyof Parent
>(props: {
    parent: FormState<Parent, ParentState, ParentError>;
    name: Key;
    children: (
        props: FormState<Parent[Key], ParentState, ParentError>
    ) => React.ReactNode;
}) {
    const arr = useChildForm(props.parent, props.name);
    return <React.Fragment>{props.children(arr)}</React.Fragment>;
}
