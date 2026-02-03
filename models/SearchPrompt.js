const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const SearchPrompt = sequelize.define('SearchPrompt', {
        prompt_id: {
            type: DataTypes.UUID,
            defaultValue: DataTypes.UUIDV4,
            primaryKey: true,
        },
        user_id: {
            type: DataTypes.UUID,
            allowNull: true,
        },
        text: {
            type: DataTypes.TEXT,
            allowNull: false,
        },
        max_price: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: true,
        },
        lifestyle_filter: {
            type: DataTypes.JSONB,
            allowNull: true,
        },
        created_at: {
            type: DataTypes.DATE,
            defaultValue: DataTypes.NOW,
        },
    }, {
        tableName: 'search_prompts',
        timestamps: false,
    });

    SearchPrompt.associate = (models) => {
        SearchPrompt.belongsTo(models.User, {
            foreignKey: 'user_id',
            as: 'user',
        });
    };

    return SearchPrompt;
};
