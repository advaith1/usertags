import { REST } from '@discordjs/rest'
import { WebSocketManager } from '@discordjs/ws'
import { GatewayDispatchEvents, InteractionType, Client, Utils, APIInteractionResponseCallbackData, APIApplicationCommandInteractionDataBasicOption, MessageFlags } from '@discordjs/core'

import db from './firestore'
import { firestore } from 'firebase-admin'
import { stripIndent } from 'common-tags'

import { commandIDs, emoji, token } from './config.json'
const { check, no } = emoji

const rest = new REST().setToken(token)

const gateway = new WebSocketManager({
	token,
	intents: 0,
	rest
})

const client = new Client({ rest, gateway })

client.on(GatewayDispatchEvents.Ready, async ({ data }) => {
	console.log(`✓ Connected! ${data.user.username}#${data.user.discriminator}`)
})

const tagCache = new Map<string, string[]>()

interface Tag {
	content: string
	ephemeral?: boolean
}

client.on(GatewayDispatchEvents.InteractionCreate, async ({ data: interaction, api }) => {
	if (
		(interaction.type !== InteractionType.ApplicationCommand || !Utils.isChatInputApplicationCommandInteraction(interaction))
		&& interaction.type !== InteractionType.ApplicationCommandAutocomplete
	) return

	const respond = (data: APIInteractionResponseCallbackData) => api.interactions.reply(interaction.id, interaction.token, data)
	const option = (name: string) => (interaction.data.options.find(o => o.name === name) as APIApplicationCommandInteractionDataBasicOption)?.value as string
	const userID = interaction.member?.user.id ?? interaction.user.id

	if (interaction.type === InteractionType.ApplicationCommandAutocomplete) {
		let tags = tagCache.get(userID)
		if (!tags) {
			const doc = await db.collection('users').doc(userID).get()
			tags = Object.keys(doc.data() ?? {}).sort()
			tagCache.set(userID, tags)
		}

		api.interactions.createAutocompleteResponse(interaction.id, interaction.token, {
			choices: tags
				.filter(t => t.startsWith(option('tag')))
				.map(t => ({ name: t, value: t }))
				.slice(0, 25)
		})

	} else if (interaction.data.id === commandIDs.ping) {
		await api.interactions.defer(interaction.id, interaction.token)
		const reply = await api.interactions.getOriginalReply(interaction.application_id, interaction.token)
		const start = Math.floor(Number(interaction.id) / 2 ** 22) + 1420070400000;
		const end = new Date(reply.timestamp).getTime()
		api.interactions.editReply(interaction.application_id, interaction.token, {
			content: `🏓 Pong! Took **${end - start}**ms.`
		})

	} else if (interaction.data.id === commandIDs.help) {
		respond({
			content: stripIndent`
				[Usertags](<https://github.com/advaith1/usertags>) is a version of [Slashtags](<https://github.com/advaith1/slashtags>) for global user tags.
				* Use </create:${commandIDs.create}> to create a tag, </edit:${commandIDs.edit}> to edit a tag, and </delete:${commandIDs.delete}> to delete a tag.
				* Use </tag:${commandIDs.tag}> to send a tag.
				Created by [advaith](<https://advaith.io>)`
		})

	} else if (interaction.data.id === commandIDs.create) {
		if (option('name')?.length > 100)
			return respond({ content: no+'name must be 1 to 100 characters', flags: MessageFlags.Ephemeral })
		if (!option('content') || option('content').length > 2000)
			return respond({ content: no+'content must be 1 to 2000 characters', flags: MessageFlags.Ephemeral })

		let error = false

		await db.collection('users').doc(userID).set({
			[option('name')]: {
				content: option('content'),
				ephemeral: option('ephemeral')
			}
		}, { merge: true }).catch(e => {
			error = true
			respond({ content: no+`error: ${e}`, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } })
		})

		if (!error) {
			respond({ content: check+`created tag ${option('name')}!`, flags: MessageFlags.Ephemeral })
			tagCache.get(userID)?.push(option('name'))
		}

	} else if (interaction.data.id === commandIDs.edit) {
		if ((!option('newname') || option('newname') === option('tag')) && !option('content') && option('ephemeral') === undefined)
			return respond({ content: no+"you didn't provide any new data!", flags: MessageFlags.Ephemeral })
		if (option('newname')?.length > 100)
			return respond({ content: no+'newname must be 1 to 100 characters', flags: MessageFlags.Ephemeral })
		if (option('content')?.length > 2000)
			return respond({ content: no+'content must be 1 to 2000 characters', flags: MessageFlags.Ephemeral })

		let error = false

		const doc = await db.collection('users').doc(userID).get()
		const tag = doc.data()?.[option('tag')] as Tag
		if (!tag) return respond({ content: no+'tag not found', flags: MessageFlags.Ephemeral })

		let data: object
		if (option('newname')) {
			// rename
			data = {
				[option('tag')]: firestore.FieldValue.delete(),
				[option('newname')]: {
					content: option('content') ?? tag.content,
					ephemeral: option('ephemeral') ?? tag.ephemeral
				}
			}
		} else {
			data = {
				[option('tag')]: {
					content: option('content'),
					ephemeral: option('ephemeral')
				}
			}
		}

		await db.collection('users').doc(userID).set(data, { merge: true }).catch(e => {
			error = true
			respond({ content: no+`error: ${e}`, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } })
		})

		if (!error) {
			respond({ content: check+`edited tag ${option('newname') ?? option('tag')}!`, flags: MessageFlags.Ephemeral })
			if (option('newname'))
				tagCache.set(userID, tagCache.get(userID)?.map(t => t === option('tag') ? option('newname') : t).sort())
		}

	} else if (interaction.data.id === commandIDs.delete) {
		let error = false

		const doc = await db.collection('users').doc(userID).get()
		const tag = doc.data()?.[option('tag')] as Tag
		if (!tag) return respond({ content: no+'tag not found', flags: MessageFlags.Ephemeral })

		await db.collection('users').doc(userID).update({
			[option('tag')]: firestore.FieldValue.delete()
		}).catch(e => {
			error = true
			respond({ content: no+`error: ${e}`, flags: MessageFlags.Ephemeral, allowed_mentions: { parse: [] } })
		})

		if (!error) {
			respond({ content: check+`deleted tag ${option('tag')}!`, flags: MessageFlags.Ephemeral })
			tagCache.set(userID, tagCache.get(userID)?.filter(t => t !== option('tag')).sort())
		}

	} else if (interaction.data.id === commandIDs.tag) {
		const doc = await db.collection('users').doc(userID).get()
		const tag = doc.data()?.[option('tag')] as Tag
		if (!tag) return respond({ content: no+'tag not found', flags: MessageFlags.Ephemeral })
		respond({ content: tag?.content, flags: tag?.ephemeral ? MessageFlags.Ephemeral : undefined, allowed_mentions: { parse: [] } })
			.catch(console.log)
	}

})

gateway.connect()
